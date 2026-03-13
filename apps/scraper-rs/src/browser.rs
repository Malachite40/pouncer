use std::{
    fs, io,
    path::{Path, PathBuf},
    process::{self, Stdio},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use reqwest::{Client, header};
use thirtyfour::{
    CapabilitiesHelper, ChromeCapabilities, ChromiumLikeCapabilities, PageLoadStrategy, WebDriver,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, ChildStderr, Command},
    time::{sleep, timeout},
};
use tracing::{info, warn};

use crate::{config::Settings, runner::BrowserHealth, scrape::get_wait_selectors};

const CHROME_SESSION_ROOT: &str = "/tmp/pounce/sessions";
#[cfg(target_os = "linux")]
const CHROME_SESSION_MATCH: &str = "/tmp/pounce/sessions/chrome-profile-";
static NEXT_CHROME_PROFILE_ID: AtomicUsize = AtomicUsize::new(0);

#[derive(Debug, Clone)]
pub enum PageFetchOutcome {
    Html(String),
    Error(String),
}

#[derive(Debug, Clone)]
pub enum FetchError {
    Timeout(String),
    BrowserSession(String),
    Unexpected(String),
}

#[async_trait]
pub trait StaticPageFetcher: Send + Sync {
    async fn fetch(&self, url: &str) -> Result<PageFetchOutcome, FetchError>;
}

#[async_trait]
pub trait DynamicPageFetcher: Send {
    async fn start(&mut self) -> Result<(), FetchError>;
    async fn shutdown(&mut self);
    fn health(&self) -> BrowserHealth;
    async fn recycle(&mut self, reason: &str);
    async fn fetch(
        &mut self,
        url: &str,
        css_selector: Option<&str>,
    ) -> Result<PageFetchOutcome, FetchError>;
}

pub struct HttpStaticFetcher {
    client: Client,
}

impl HttpStaticFetcher {
    pub fn new(settings: Arc<Settings>) -> Self {
        let mut headers = header::HeaderMap::new();
        headers.insert(
            header::USER_AGENT,
            header::HeaderValue::from_str(&settings.browser_user_agent)
                .expect("valid browser user agent"),
        );
        headers.insert(
            header::ACCEPT_LANGUAGE,
            header::HeaderValue::from_str(&settings.browser_accept_language)
                .expect("valid browser accept language"),
        );

        let client = Client::builder()
            .default_headers(headers)
            .redirect(reqwest::redirect::Policy::limited(10))
            .timeout(Duration::from_millis(settings.scrape_timeout_ms))
            .build()
            .expect("reqwest client should build");

        Self { client }
    }
}

#[async_trait]
impl StaticPageFetcher for HttpStaticFetcher {
    async fn fetch(&self, url: &str) -> Result<PageFetchOutcome, FetchError> {
        let response = self
            .client
            .get(url)
            .send()
            .await
            .map_err(map_reqwest_error)?;
        let status = response.status();
        if status.is_client_error() || status.is_server_error() {
            let detail = format!(
                "HTTP {}: {}",
                status.as_u16(),
                status.canonical_reason().unwrap_or("Unknown"),
            );
            return Ok(PageFetchOutcome::Error(detail));
        }

        let html = response
            .text()
            .await
            .map_err(|err| FetchError::Unexpected(err.to_string()))?;
        Ok(PageFetchOutcome::Html(html))
    }
}

#[async_trait]
trait BrowserProcessHandle: Send {
    fn has_exited(&mut self) -> Result<bool, FetchError>;
    async fn kill(&mut self) -> Result<(), String>;
}

#[async_trait]
trait BrowserSessionHandle: Send {
    async fn goto(&mut self, url: &str) -> Result<(), String>;
    async fn source(&mut self) -> Result<String, String>;
    async fn find(&mut self, selector: &str) -> Result<(), String>;
    async fn current_window(&mut self) -> Result<String, String>;
    async fn windows(&mut self) -> Result<Vec<String>, String>;
    async fn switch_to_window(&mut self, handle: &str) -> Result<(), String>;
    async fn close_window(&mut self) -> Result<(), String>;
    async fn delete_all_cookies(&mut self) -> Result<(), String>;
    async fn quit(&mut self) -> Result<(), String>;
}

#[async_trait]
trait BrowserEngine: Send + Sync {
    async fn launch_process(
        &self,
        settings: Arc<Settings>,
    ) -> Result<Box<dyn BrowserProcessHandle>, FetchError>;
    async fn create_session(
        &self,
        settings: Arc<Settings>,
        profile_dir: &SessionProfileDir,
    ) -> Result<Box<dyn BrowserSessionHandle>, FetchError>;
}

#[derive(Default)]
struct BrowserRuntime {
    child: Option<Box<dyn BrowserProcessHandle>>,
    session: Option<Box<dyn BrowserSessionHandle>>,
    profile_dir: Option<SessionProfileDir>,
}

pub struct BrowserWorker {
    settings: Arc<Settings>,
    engine: Arc<dyn BrowserEngine>,
    runtime: BrowserRuntime,
    dynamic_enabled: bool,
    restart_count: usize,
    last_launch_error: Option<String>,
    last_browser_error: Option<String>,
    session_ready: bool,
}

impl BrowserWorker {
    pub fn new(settings: Arc<Settings>, dynamic_enabled: bool) -> Self {
        Self::with_engine(
            settings,
            Arc::new(ChromedriverEngine::default()),
            dynamic_enabled,
        )
    }

    fn with_engine(
        settings: Arc<Settings>,
        engine: Arc<dyn BrowserEngine>,
        dynamic_enabled: bool,
    ) -> Self {
        Self {
            settings,
            engine,
            runtime: BrowserRuntime::default(),
            dynamic_enabled,
            restart_count: 0,
            last_launch_error: None,
            last_browser_error: None,
            session_ready: !dynamic_enabled,
        }
    }

    async fn ensure_browser(&mut self) -> Result<bool, FetchError> {
        if !self.dynamic_enabled {
            return Ok(false);
        }

        let needs_spawn = match self.runtime.child.as_mut() {
            Some(child) => child.has_exited()? || self.runtime.session.is_none(),
            None => true,
        };

        if !needs_spawn {
            self.session_ready = true;
            return Ok(true);
        }

        self.shutdown_runtime(None).await;

        let mut last_error = None;
        let launch_attempts = self.settings.browser_restart_attempts.max(1);
        for attempt in 0..launch_attempts {
            match self.launch_browser().await {
                Ok(()) => {
                    self.last_launch_error = None;
                    self.last_browser_error = None;
                    self.session_ready = true;
                    return Ok(true);
                }
                Err(err) => {
                    last_error = Some(fetch_error_detail(err));
                }
            }

            if attempt + 1 < launch_attempts {
                sleep(Duration::from_millis(
                    self.settings.browser_restart_backoff_ms,
                ))
                .await;
            }
        }

        let detail = last_error.unwrap_or_else(|| "failed to launch chromedriver".to_string());
        self.last_launch_error = Some(detail.clone());
        self.last_browser_error = Some(detail.clone());
        self.session_ready = false;
        Err(FetchError::BrowserSession(detail))
    }

    async fn launch_browser(&mut self) -> Result<(), FetchError> {
        let profile_dir = SessionProfileDir::new(Path::new(CHROME_SESSION_ROOT))?;
        let mut child = self.engine.launch_process(self.settings.clone()).await?;

        match self
            .engine
            .create_session(self.settings.clone(), &profile_dir)
            .await
        {
            Ok(session) => {
                self.runtime.child = Some(child);
                self.runtime.session = Some(session);
                self.runtime.profile_dir = Some(profile_dir);
                Ok(())
            }
            Err(err) => {
                self.restart_count += 1;
                self.last_browser_error = Some(fetch_error_detail(err.clone()));
                let _ = child.kill().await;
                cleanup_orphaned_chrome_processes().await;
                Err(err)
            }
        }
    }

    async fn shutdown_runtime(&mut self, reason: Option<&str>) {
        if reason.is_some() || self.runtime.child.is_some() || self.runtime.session.is_some() {
            self.restart_count += 1;
        }
        if let Some(reason) = reason {
            self.last_browser_error = Some(reason.to_string());
        }
        self.session_ready = !self.dynamic_enabled;

        if let Some(mut session) = self.runtime.session.take() {
            match timeout(
                Duration::from_millis(self.settings.page_selector_timeout_ms),
                session.quit(),
            )
            .await
            {
                Ok(Ok(())) => {}
                Ok(Err(err)) => {
                    warn!(error = %err, "failed to quit webdriver session during recycle");
                }
                Err(_) => {
                    warn!(
                        timeout_ms = self.settings.page_selector_timeout_ms,
                        "timed out quitting webdriver session during recycle"
                    );
                }
            }
        }

        if let Some(mut child) = self.runtime.child.take() {
            if let Err(err) = child.kill().await {
                warn!(error = %err, "failed to recycle chromedriver cleanly");
            }
        }

        self.runtime.profile_dir.take();
        cleanup_orphaned_chrome_processes().await;
    }

    async fn reset_page_state(&mut self) -> Result<(), FetchError> {
        let session = self.runtime.session.as_mut().ok_or_else(|| {
            FetchError::BrowserSession("browser session is not ready".to_string())
        })?;

        let primary = session
            .current_window()
            .await
            .map_err(map_browser_reset_message)?;
        let handles = session.windows().await.map_err(map_browser_reset_message)?;
        for handle in handles {
            if handle == primary {
                continue;
            }
            session
                .switch_to_window(&handle)
                .await
                .map_err(map_browser_reset_message)?;
            session
                .close_window()
                .await
                .map_err(map_browser_reset_message)?;
        }
        session
            .switch_to_window(&primary)
            .await
            .map_err(map_browser_reset_message)?;
        session
            .goto("about:blank")
            .await
            .map_err(map_browser_reset_message)?;
        session
            .delete_all_cookies()
            .await
            .map_err(map_browser_reset_message)?;
        Ok(())
    }

    async fn fetch_with_session(
        &mut self,
        url: &str,
        css_selector: Option<&str>,
    ) -> Result<PageFetchOutcome, FetchError> {
        let wait_selectors = get_wait_selectors(
            url,
            css_selector,
            &self.settings.dynamic_default_wait_selector,
        );
        let session = self.runtime.session.as_mut().ok_or_else(|| {
            FetchError::BrowserSession("browser session is not ready".to_string())
        })?;

        match session.goto(url).await {
            Ok(()) => {}
            Err(err) => {
                let mapped_error = map_webdriver_message(err);
                if matches!(&mapped_error, FetchError::Timeout(_)) {
                    warn!(
                        url = %url,
                        timeout_ms = self.settings.page_navigation_timeout_ms,
                        "dynamic navigation timed out"
                    );
                }
                return Err(mapped_error);
            }
        }

        wait_for_page_ready(
            session.as_mut(),
            url,
            &wait_selectors,
            Duration::from_millis(self.settings.page_selector_timeout_ms),
        )
        .await?;
        if self.settings.dynamic_wait_ms > 0 {
            sleep(Duration::from_millis(self.settings.dynamic_wait_ms)).await;
        }
        let html = session.source().await.map_err(map_webdriver_message)?;
        Ok(PageFetchOutcome::Html(html))
    }
}

#[async_trait]
impl DynamicPageFetcher for BrowserWorker {
    async fn start(&mut self) -> Result<(), FetchError> {
        if !self.dynamic_enabled {
            return Ok(());
        }
        self.ensure_browser().await.map(|_| ())
    }

    async fn shutdown(&mut self) {
        self.shutdown_runtime(None).await;
    }

    fn health(&self) -> BrowserHealth {
        BrowserHealth {
            total_workers: usize::from(self.dynamic_enabled),
            ready_workers: usize::from(
                self.dynamic_enabled
                    && self.session_ready
                    && self.runtime.child.is_some()
                    && self.runtime.session.is_some(),
            ),
            restart_count: self.restart_count,
            last_launch_error: self.last_launch_error.clone(),
            last_browser_error: self.last_browser_error.clone(),
        }
    }

    async fn recycle(&mut self, reason: &str) {
        self.shutdown_runtime(Some(reason)).await;
    }

    async fn fetch(
        &mut self,
        url: &str,
        css_selector: Option<&str>,
    ) -> Result<PageFetchOutcome, FetchError> {
        for attempt in 0..2 {
            if !self.ensure_browser().await? {
                return Err(FetchError::BrowserSession(
                    "dynamic browser support is disabled".to_string(),
                ));
            }

            if let Err(err) = self.reset_page_state().await {
                let detail = fetch_error_detail(err.clone());
                warn!(
                    attempt = attempt + 1,
                    error = %detail,
                    "browser state reset failed; recycling worker browser"
                );
                self.shutdown_runtime(Some(&detail)).await;
                if attempt == 1 {
                    return Err(FetchError::BrowserSession(detail));
                }
                continue;
            }

            match self.fetch_with_session(url, css_selector).await {
                Ok(outcome) => {
                    self.last_browser_error = None;
                    self.session_ready = true;
                    return Ok(outcome);
                }
                Err(FetchError::BrowserSession(detail)) => {
                    warn!(
                        attempt = attempt + 1,
                        error = %detail,
                        "browser session failed; recycling worker browser"
                    );
                    self.shutdown_runtime(Some(&detail)).await;
                    if attempt == 1 {
                        return Err(FetchError::BrowserSession(detail));
                    }
                }
                Err(err) => return Err(err),
            }
        }

        Err(FetchError::BrowserSession(
            "failed to recover browser session".to_string(),
        ))
    }
}

fn build_chrome_capabilities(
    settings: &Settings,
    profile_dir: &SessionProfileDir,
) -> Result<ChromeCapabilities, FetchError> {
    let mut capabilities = ChromeCapabilities::new();
    capabilities
        .set_page_load_strategy(PageLoadStrategy::Eager)
        .map_err(map_browser_capability_error)?;
    capabilities
        .add_arg("--headless=new")
        .map_err(map_browser_capability_error)?;
    capabilities
        .add_arg("--no-sandbox")
        .map_err(map_browser_capability_error)?;
    capabilities
        .add_arg("--disable-dev-shm-usage")
        .map_err(map_browser_capability_error)?;
    capabilities
        .add_arg("--disable-gpu")
        .map_err(map_browser_capability_error)?;
    capabilities
        .add_arg("--disable-software-rasterizer")
        .map_err(map_browser_capability_error)?;
    capabilities
        .add_arg(&profile_dir.chrome_arg())
        .map_err(map_browser_capability_error)?;

    let language_arg = format!("--lang={}", settings.browser_accept_language);
    capabilities
        .add_arg(&language_arg)
        .map_err(map_browser_capability_error)?;

    let user_agent_arg = format!("--user-agent={}", settings.browser_user_agent);
    capabilities
        .add_arg(&user_agent_arg)
        .map_err(map_browser_capability_error)?;

    if let Some(binary) = settings.chrome_binary_path.as_deref() {
        capabilities
            .set_binary(binary)
            .map_err(map_browser_capability_error)?;
    }

    Ok(capabilities)
}

#[derive(Default)]
struct ChromedriverEngine {
    client: Client,
}

#[async_trait]
impl BrowserEngine for ChromedriverEngine {
    async fn launch_process(
        &self,
        settings: Arc<Settings>,
    ) -> Result<Box<dyn BrowserProcessHandle>, FetchError> {
        let mut command = Command::new(&settings.chromedriver_path);
        command
            .arg(format!("--port={}", settings.webdriver_port))
            .arg("--allowed-ips=")
            .stdout(Stdio::null())
            .stderr(Stdio::piped());

        if settings.chromedriver_verbose_log {
            command.arg("--verbose");
        }

        let mut child = command.spawn().map_err(|err| {
            FetchError::BrowserSession(format!("failed to spawn chromedriver: {err}"))
        })?;

        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                log_chromedriver_stderr(stderr).await;
            });
        }

        info!(
            path = %settings.chromedriver_path,
            port = settings.webdriver_port,
            verbose = settings.chromedriver_verbose_log,
            "chromedriver started"
        );

        if let Err(err) = self.wait_until_ready(&settings).await {
            let _ = child.kill().await;
            let _ = child.wait().await;
            return Err(err);
        }

        Ok(Box::new(TokioChildProcess { child }))
    }

    async fn create_session(
        &self,
        settings: Arc<Settings>,
        profile_dir: &SessionProfileDir,
    ) -> Result<Box<dyn BrowserSessionHandle>, FetchError> {
        let capabilities = build_chrome_capabilities(settings.as_ref(), profile_dir)?;
        let driver = WebDriver::new(&settings.webdriver_url(), capabilities)
            .await
            .map_err(map_webdriver_error)?;
        driver
            .set_page_load_timeout(Duration::from_millis(settings.page_navigation_timeout_ms))
            .await
            .map_err(map_webdriver_error)?;

        Ok(Box::new(RealBrowserSession {
            driver: Some(driver),
        }))
    }
}

impl ChromedriverEngine {
    async fn wait_until_ready(&self, settings: &Settings) -> Result<(), FetchError> {
        let deadline = Instant::now() + Duration::from_millis(settings.browser_launch_timeout_ms);
        let status_url = format!("{}/status", settings.webdriver_url());

        loop {
            match self.client.get(&status_url).send().await {
                Ok(response) if response.status().is_success() => return Ok(()),
                Ok(_) | Err(_) if Instant::now() >= deadline => {
                    return Err(FetchError::Timeout(
                        "timed out waiting for chromedriver readiness".to_string(),
                    ));
                }
                Ok(_) | Err(_) => sleep(Duration::from_millis(250)).await,
            }
        }
    }
}

struct TokioChildProcess {
    child: Child,
}

#[async_trait]
impl BrowserProcessHandle for TokioChildProcess {
    fn has_exited(&mut self) -> Result<bool, FetchError> {
        self.child
            .try_wait()
            .map_err(|err| FetchError::BrowserSession(err.to_string()))
            .map(|status| status.is_some())
    }

    async fn kill(&mut self) -> Result<(), String> {
        self.child.kill().await.map_err(|err| err.to_string())?;
        self.child.wait().await.map_err(|err| err.to_string())?;
        Ok(())
    }
}

struct RealBrowserSession {
    driver: Option<WebDriver>,
}

#[async_trait]
impl BrowserSessionHandle for RealBrowserSession {
    async fn goto(&mut self, url: &str) -> Result<(), String> {
        self.driver
            .as_ref()
            .expect("webdriver present")
            .goto(url)
            .await
            .map_err(|err| err.to_string())
    }

    async fn source(&mut self) -> Result<String, String> {
        self.driver
            .as_ref()
            .expect("webdriver present")
            .source()
            .await
            .map_err(|err| err.to_string())
    }

    async fn find(&mut self, selector: &str) -> Result<(), String> {
        self.driver
            .as_ref()
            .expect("webdriver present")
            .find(thirtyfour::By::Css(selector.to_string()))
            .await
            .map(|_| ())
            .map_err(|err| err.to_string())
    }

    async fn current_window(&mut self) -> Result<String, String> {
        self.driver
            .as_ref()
            .expect("webdriver present")
            .window()
            .await
            .map(|handle| handle.to_string())
            .map_err(|err| err.to_string())
    }

    async fn windows(&mut self) -> Result<Vec<String>, String> {
        self.driver
            .as_ref()
            .expect("webdriver present")
            .windows()
            .await
            .map(|handles| {
                handles
                    .into_iter()
                    .map(|handle| handle.to_string())
                    .collect()
            })
            .map_err(|err| err.to_string())
    }

    async fn switch_to_window(&mut self, handle: &str) -> Result<(), String> {
        self.driver
            .as_ref()
            .expect("webdriver present")
            .switch_to_window(handle.to_string().into())
            .await
            .map_err(|err| err.to_string())
    }

    async fn close_window(&mut self) -> Result<(), String> {
        self.driver
            .as_ref()
            .expect("webdriver present")
            .close_window()
            .await
            .map_err(|err| err.to_string())
    }

    async fn delete_all_cookies(&mut self) -> Result<(), String> {
        self.driver
            .as_ref()
            .expect("webdriver present")
            .delete_all_cookies()
            .await
            .map_err(|err| err.to_string())
    }

    async fn quit(&mut self) -> Result<(), String> {
        match self.driver.take() {
            Some(driver) => driver.quit().await.map_err(|err| err.to_string()),
            None => Ok(()),
        }
    }
}

struct SessionProfileDir {
    path: PathBuf,
}

impl SessionProfileDir {
    fn new(root: &Path) -> Result<Self, FetchError> {
        fs::create_dir_all(root).map_err(|err| {
            FetchError::BrowserSession(format!("failed to create session root: {err}"))
        })?;

        let unique_id = NEXT_CHROME_PROFILE_ID.fetch_add(1, Ordering::SeqCst);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = root.join(format!(
            "chrome-profile-{}-{timestamp}-{unique_id}",
            process::id()
        ));

        fs::create_dir(&path).map_err(|err| {
            FetchError::BrowserSession(format!(
                "failed to create browser profile dir {}: {err}",
                path.display()
            ))
        })?;

        Ok(Self { path })
    }

    fn chrome_arg(&self) -> String {
        format!("--user-data-dir={}", self.path.display())
    }
}

impl Drop for SessionProfileDir {
    fn drop(&mut self) {
        if let Err(err) = fs::remove_dir_all(&self.path) {
            if err.kind() != io::ErrorKind::NotFound {
                warn!(
                    path = %self.path.display(),
                    error = %err,
                    "failed to remove chrome profile dir"
                );
            }
        }
    }
}

async fn log_chromedriver_stderr(stderr: ChildStderr) {
    let mut lines = BufReader::new(stderr).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => warn!(message = %line, "chromedriver stderr"),
            Ok(None) => break,
            Err(err) => {
                warn!(error = %err, "failed to read chromedriver stderr");
                break;
            }
        }
    }
}

async fn cleanup_orphaned_chrome_processes() {
    #[cfg(target_os = "linux")]
    {
        match Command::new("pkill")
            .arg("-f")
            .arg(CHROME_SESSION_MATCH)
            .status()
            .await
        {
            Ok(status) if status.success() => {
                warn!(
                    pattern = CHROME_SESSION_MATCH,
                    "cleaned up orphaned chrome processes"
                );
            }
            Ok(status) if status.code() == Some(1) => {}
            Ok(status) => {
                warn!(
                    pattern = CHROME_SESSION_MATCH,
                    code = status.code().unwrap_or_default(),
                    "chrome process cleanup exited unexpectedly"
                );
            }
            Err(err) => {
                warn!(error = %err, "failed to invoke chrome process cleanup");
            }
        }
    }
}

async fn wait_for_page_ready(
    session: &mut dyn BrowserSessionHandle,
    url: &str,
    selectors: &[String],
    timeout: Duration,
) -> Result<(), FetchError> {
    let mut last_error = None;

    for selector in selectors {
        match wait_for_selector(session, selector, timeout).await {
            Ok(()) => return Ok(()),
            Err(FetchError::Timeout(detail)) => {
                last_error = Some(detail);
            }
            Err(err) => return Err(err),
        }
    }

    Err(FetchError::Timeout(last_error.unwrap_or_else(|| {
        format!("Timed out waiting for page readiness on {url}")
    })))
}

async fn wait_for_selector(
    session: &mut dyn BrowserSessionHandle,
    selector: &str,
    timeout: Duration,
) -> Result<(), FetchError> {
    let deadline = Instant::now() + timeout;

    loop {
        match session.find(selector).await {
            Ok(_) => return Ok(()),
            Err(message) => {
                let normalized = message.to_lowercase();
                if normalized.contains("invalid selector") {
                    return Err(FetchError::Unexpected(message));
                }
                if is_browser_session_message(&normalized) {
                    return Err(FetchError::BrowserSession(message));
                }
                if Instant::now() >= deadline {
                    return Err(FetchError::Timeout(format!(
                        "Timed out waiting for selector {selector}: {message}"
                    )));
                }
                sleep(Duration::from_millis(200)).await;
            }
        }
    }
}

fn map_reqwest_error(err: reqwest::Error) -> FetchError {
    if err.is_timeout() {
        return FetchError::Timeout(format!("Static fetch timed out: {err}"));
    }
    FetchError::Unexpected(err.to_string())
}

fn map_browser_capability_error(err: thirtyfour::error::WebDriverError) -> FetchError {
    FetchError::BrowserSession(err.to_string())
}

fn map_webdriver_error(err: thirtyfour::error::WebDriverError) -> FetchError {
    map_webdriver_message(err.to_string())
}

fn map_browser_reset_message(message: String) -> FetchError {
    let detail = fetch_error_detail(map_webdriver_message(message));
    FetchError::BrowserSession(format!("browser reset failed: {detail}"))
}

fn map_webdriver_message(message: String) -> FetchError {
    let normalized = message.to_lowercase();
    if is_browser_session_message(&normalized) {
        return FetchError::BrowserSession(message);
    }
    if normalized.contains("timeout") || normalized.contains("timed out") {
        return FetchError::Timeout(format!("Page timeout: {message}"));
    }
    FetchError::Unexpected(message)
}

fn is_browser_session_message(normalized: &str) -> bool {
    normalized.contains("connection refused")
        || normalized.contains("session not created")
        || normalized.contains("browser has been closed")
        || normalized.contains("target frame detached")
        || normalized.contains("chrome not reachable")
        || normalized.contains("invalid session id")
        || normalized.contains("tab crashed")
        || normalized.contains("failed to start a thread")
        || normalized.contains("pthread_create")
        || normalized.contains("resource temporarily unavailable")
        || normalized.contains("timed out receiving message from renderer")
}

fn fetch_error_detail(err: FetchError) -> String {
    match err {
        FetchError::Timeout(detail)
        | FetchError::BrowserSession(detail)
        | FetchError::Unexpected(detail) => detail,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::VecDeque,
        sync::{Arc, Mutex as StdMutex},
    };

    use super::*;

    #[tokio::test]
    async fn retries_browser_session_after_reset_and_recycles_child() {
        let settings = Arc::new(Settings::default());
        let engine = Arc::new(FakeBrowserEngine::new(vec![
            FakeSessionPlan::CreateError(FetchError::BrowserSession(
                "session not created".to_string(),
            )),
            FakeSessionPlan::Session(FakeSessionConfig::html("<html><body>ok</body></html>")),
        ]));
        let mut worker = BrowserWorker::with_engine(settings, engine.clone(), true);

        let result = worker
            .fetch("https://example.com/product", Some("body"))
            .await
            .expect("fetch should recover");

        assert!(matches!(result, PageFetchOutcome::Html(_)));
        assert_eq!(engine.launch_calls(), 2);
        assert_eq!(engine.create_session_calls(), 2);
        assert_eq!(engine.killed_processes(), vec![0]);

        let health = worker.health();
        assert_eq!(health.total_workers, 1);
        assert_eq!(health.ready_workers, 1);
        assert_eq!(health.restart_count, 1);
        assert_eq!(health.last_browser_error, None);
    }

    #[tokio::test]
    async fn repeated_browser_session_failures_leave_browser_unready() {
        let settings = Arc::new(Settings::default());
        let engine = Arc::new(FakeBrowserEngine::new(vec![
            FakeSessionPlan::CreateError(FetchError::BrowserSession(
                "session not created".to_string(),
            )),
            FakeSessionPlan::CreateError(FetchError::BrowserSession(
                "chrome not reachable".to_string(),
            )),
        ]));
        let mut worker = BrowserWorker::with_engine(settings, engine.clone(), true);

        let err = worker
            .fetch("https://example.com/product", Some("body"))
            .await
            .expect_err("fetch should fail after one retry");

        let detail = match err {
            FetchError::BrowserSession(detail) => detail,
            other => panic!("unexpected fetch error: {other:?}"),
        };
        assert_eq!(detail, "chrome not reachable");
        assert_eq!(engine.launch_calls(), 2);
        assert_eq!(engine.killed_processes(), vec![0, 1]);

        let health = worker.health();
        assert_eq!(health.total_workers, 1);
        assert_eq!(health.ready_workers, 0);
        assert_eq!(health.restart_count, 2);
        assert_eq!(
            health.last_browser_error.as_deref(),
            Some("chrome not reachable")
        );
    }

    #[tokio::test]
    async fn reuses_browser_session_across_fetches() {
        let settings = Arc::new(Settings::default());
        let engine = Arc::new(FakeBrowserEngine::new(vec![FakeSessionPlan::Session(
            FakeSessionConfig::html("<html><body>ok</body></html>"),
        )]));
        let mut worker = BrowserWorker::with_engine(settings, engine.clone(), true);

        worker
            .fetch("https://example.com/product-1", Some("body"))
            .await
            .expect("first fetch");
        worker
            .fetch("https://example.com/product-2", Some("body"))
            .await
            .expect("second fetch");

        assert_eq!(engine.launch_calls(), 1);
        assert_eq!(engine.create_session_calls(), 1);
        let session = engine
            .created_sessions()
            .into_iter()
            .next()
            .expect("session");
        assert_eq!(session.goto_calls.load(Ordering::SeqCst), 4);
    }

    #[tokio::test]
    async fn reset_page_state_closes_extra_windows_and_deletes_cookies() {
        let settings = Arc::new(Settings::default());
        let engine = Arc::new(FakeBrowserEngine::new(vec![FakeSessionPlan::Session(
            FakeSessionConfig::html("<html><body>ok</body></html>")
                .with_windows(vec!["primary", "popup"]),
        )]));
        let mut worker = BrowserWorker::with_engine(settings, engine.clone(), true);

        worker
            .fetch("https://example.com/product", Some("body"))
            .await
            .expect("fetch");

        let session = engine
            .created_sessions()
            .into_iter()
            .next()
            .expect("session");
        assert_eq!(session.delete_all_cookies_calls.load(Ordering::SeqCst), 1);
        assert_eq!(session.close_window_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            session.window_handles.lock().unwrap().as_slice(),
            &["primary"]
        );
    }

    #[tokio::test]
    async fn navigation_timeout_returns_fetch_timeout_without_marking_browser_unready() {
        let mut settings = Settings::default();
        settings.page_navigation_timeout_ms = 10;
        settings.page_selector_timeout_ms = 10;
        let settings = Arc::new(settings);
        let engine = Arc::new(FakeBrowserEngine::new(vec![FakeSessionPlan::Session(
            FakeSessionConfig::html("<html><body>ok</body></html>").with_goto_outcomes(vec![
                None,
                Some("timed out navigating to https://example.com/product after 10ms"),
            ]),
        )]));
        let mut worker = BrowserWorker::with_engine(settings, engine, true);

        let err = worker
            .fetch("https://example.com/product", Some("#cta"))
            .await
            .expect_err("fetch should time out during navigation");

        let detail = match err {
            FetchError::Timeout(detail) => detail,
            other => panic!("unexpected fetch error: {other:?}"),
        };
        assert!(detail.contains("Page timeout:"));
        assert!(detail.contains("timed out navigating to https://example.com/product"));

        let health = worker.health();
        assert_eq!(health.ready_workers, 1);
        assert_eq!(health.restart_count, 0);
        assert_eq!(health.last_browser_error, None);
    }

    #[tokio::test]
    async fn renderer_timeout_recycles_browser_and_returns_browser_session() {
        let mut settings = Settings::default();
        settings.page_navigation_timeout_ms = 10;
        settings.page_selector_timeout_ms = 10;
        let settings = Arc::new(settings);
        let engine = Arc::new(FakeBrowserEngine::new(vec![
            FakeSessionPlan::Session(
                FakeSessionConfig::html("<html><body>ok</body></html>").with_goto_outcomes(vec![
                    None,
                    Some("Timed out receiving message from renderer: 29.704"),
                ]),
            ),
            FakeSessionPlan::Session(
                FakeSessionConfig::html("<html><body>ok</body></html>").with_goto_outcomes(vec![
                    None,
                    Some("Timed out receiving message from renderer: 29.704"),
                ]),
            ),
        ]));
        let mut worker = BrowserWorker::with_engine(settings, engine.clone(), true);

        let err = worker
            .fetch("https://example.com/product", Some("#cta"))
            .await
            .expect_err("renderer timeout should be treated as fatal");

        let detail = match err {
            FetchError::BrowserSession(detail) => detail,
            other => panic!("unexpected fetch error: {other:?}"),
        };
        assert!(detail.contains("Timed out receiving message from renderer"));
        assert_eq!(engine.killed_processes(), vec![0, 1]);
        let health = worker.health();
        assert_eq!(health.ready_workers, 0);
        assert_eq!(health.restart_count, 2);
        assert_eq!(
            health.last_browser_error.as_deref(),
            Some("Timed out receiving message from renderer: 29.704")
        );
    }

    #[tokio::test]
    async fn chrome_capabilities_use_eager_page_load_strategy() {
        let profile_dir =
            SessionProfileDir::new(std::path::Path::new(CHROME_SESSION_ROOT)).expect("profile dir");
        let capabilities =
            build_chrome_capabilities(&Settings::default(), &profile_dir).expect("capabilities");

        assert!(matches!(
            capabilities
                .page_load_strategy()
                .expect("page load strategy"),
            PageLoadStrategy::Eager
        ));
    }

    struct FakeBrowserEngine {
        state: Arc<FakeBrowserEngineState>,
    }

    impl FakeBrowserEngine {
        fn new(session_plans: Vec<FakeSessionPlan>) -> Self {
            Self {
                state: Arc::new(FakeBrowserEngineState {
                    next_process_id: AtomicUsize::new(0),
                    launch_calls: AtomicUsize::new(0),
                    create_session_calls: AtomicUsize::new(0),
                    killed_processes: StdMutex::new(Vec::new()),
                    session_plans: StdMutex::new(session_plans.into()),
                    created_sessions: StdMutex::new(Vec::new()),
                }),
            }
        }

        fn launch_calls(&self) -> usize {
            self.state.launch_calls.load(Ordering::SeqCst)
        }

        fn create_session_calls(&self) -> usize {
            self.state.create_session_calls.load(Ordering::SeqCst)
        }

        fn killed_processes(&self) -> Vec<usize> {
            self.state.killed_processes.lock().unwrap().clone()
        }

        fn created_sessions(&self) -> Vec<Arc<FakeSessionState>> {
            self.state.created_sessions.lock().unwrap().clone()
        }
    }

    struct FakeBrowserEngineState {
        next_process_id: AtomicUsize,
        launch_calls: AtomicUsize,
        create_session_calls: AtomicUsize,
        killed_processes: StdMutex<Vec<usize>>,
        session_plans: StdMutex<VecDeque<FakeSessionPlan>>,
        created_sessions: StdMutex<Vec<Arc<FakeSessionState>>>,
    }

    #[async_trait]
    impl BrowserEngine for FakeBrowserEngine {
        async fn launch_process(
            &self,
            _settings: Arc<Settings>,
        ) -> Result<Box<dyn BrowserProcessHandle>, FetchError> {
            self.state.launch_calls.fetch_add(1, Ordering::SeqCst);
            let id = self.state.next_process_id.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(FakeProcessHandle {
                id,
                exited: false,
                state: self.state.clone(),
            }))
        }

        async fn create_session(
            &self,
            _settings: Arc<Settings>,
            _profile_dir: &SessionProfileDir,
        ) -> Result<Box<dyn BrowserSessionHandle>, FetchError> {
            self.state
                .create_session_calls
                .fetch_add(1, Ordering::SeqCst);
            match self
                .state
                .session_plans
                .lock()
                .unwrap()
                .pop_front()
                .expect("session plan")
            {
                FakeSessionPlan::CreateError(err) => Err(err),
                FakeSessionPlan::Session(config) => {
                    let state = Arc::new(FakeSessionState::new(config));
                    self.state
                        .created_sessions
                        .lock()
                        .unwrap()
                        .push(state.clone());
                    Ok(Box::new(FakeSessionHandle { state }))
                }
            }
        }
    }

    enum FakeSessionPlan {
        CreateError(FetchError),
        Session(FakeSessionConfig),
    }

    struct FakeSessionConfig {
        html: String,
        goto_outcomes: VecDeque<Option<String>>,
        quit_delay_ms: u64,
        window_handles: Vec<String>,
    }

    impl FakeSessionConfig {
        fn html(html: &str) -> Self {
            Self {
                html: html.to_string(),
                goto_outcomes: VecDeque::new(),
                quit_delay_ms: 0,
                window_handles: vec!["primary".to_string()],
            }
        }

        fn with_goto_outcomes(mut self, outcomes: Vec<Option<&str>>) -> Self {
            self.goto_outcomes = outcomes
                .into_iter()
                .map(|outcome| outcome.map(str::to_string))
                .collect();
            self
        }

        fn with_windows(mut self, handles: Vec<&str>) -> Self {
            self.window_handles = handles.into_iter().map(str::to_string).collect();
            self
        }
    }

    struct FakeProcessHandle {
        id: usize,
        exited: bool,
        state: Arc<FakeBrowserEngineState>,
    }

    #[async_trait]
    impl BrowserProcessHandle for FakeProcessHandle {
        fn has_exited(&mut self) -> Result<bool, FetchError> {
            Ok(self.exited)
        }

        async fn kill(&mut self) -> Result<(), String> {
            self.exited = true;
            self.state.killed_processes.lock().unwrap().push(self.id);
            Ok(())
        }
    }

    struct FakeSessionState {
        html: String,
        goto_outcomes: StdMutex<VecDeque<Option<String>>>,
        quit_delay_ms: u64,
        window_handles: StdMutex<Vec<String>>,
        current_window: StdMutex<String>,
        goto_calls: AtomicUsize,
        close_window_calls: AtomicUsize,
        delete_all_cookies_calls: AtomicUsize,
    }

    impl FakeSessionState {
        fn new(config: FakeSessionConfig) -> Self {
            let current_window = config
                .window_handles
                .first()
                .cloned()
                .unwrap_or_else(|| "primary".to_string());
            Self {
                html: config.html,
                goto_outcomes: StdMutex::new(config.goto_outcomes),
                quit_delay_ms: config.quit_delay_ms,
                window_handles: StdMutex::new(config.window_handles),
                current_window: StdMutex::new(current_window),
                goto_calls: AtomicUsize::new(0),
                close_window_calls: AtomicUsize::new(0),
                delete_all_cookies_calls: AtomicUsize::new(0),
            }
        }
    }

    struct FakeSessionHandle {
        state: Arc<FakeSessionState>,
    }

    #[async_trait]
    impl BrowserSessionHandle for FakeSessionHandle {
        async fn goto(&mut self, _url: &str) -> Result<(), String> {
            self.state.goto_calls.fetch_add(1, Ordering::SeqCst);
            if let Some(outcome) = self.state.goto_outcomes.lock().unwrap().pop_front() {
                if let Some(error) = outcome {
                    return Err(error);
                }
            }
            Ok(())
        }

        async fn source(&mut self) -> Result<String, String> {
            Ok(self.state.html.clone())
        }

        async fn find(&mut self, _selector: &str) -> Result<(), String> {
            Ok(())
        }

        async fn current_window(&mut self) -> Result<String, String> {
            Ok(self.state.current_window.lock().unwrap().clone())
        }

        async fn windows(&mut self) -> Result<Vec<String>, String> {
            Ok(self.state.window_handles.lock().unwrap().clone())
        }

        async fn switch_to_window(&mut self, handle: &str) -> Result<(), String> {
            let handles = self.state.window_handles.lock().unwrap();
            if !handles.iter().any(|candidate| candidate == handle) {
                return Err("invalid session id".to_string());
            }
            drop(handles);
            *self.state.current_window.lock().unwrap() = handle.to_string();
            Ok(())
        }

        async fn close_window(&mut self) -> Result<(), String> {
            let current = self.state.current_window.lock().unwrap().clone();
            let mut handles = self.state.window_handles.lock().unwrap();
            if let Some(index) = handles.iter().position(|handle| handle == &current) {
                handles.remove(index);
                self.state.close_window_calls.fetch_add(1, Ordering::SeqCst);
                if let Some(next) = handles.first() {
                    *self.state.current_window.lock().unwrap() = next.clone();
                }
                return Ok(());
            }
            Err("invalid session id".to_string())
        }

        async fn delete_all_cookies(&mut self) -> Result<(), String> {
            self.state
                .delete_all_cookies_calls
                .fetch_add(1, Ordering::SeqCst);
            Ok(())
        }

        async fn quit(&mut self) -> Result<(), String> {
            if self.state.quit_delay_ms > 0 {
                sleep(Duration::from_millis(self.state.quit_delay_ms)).await;
            }
            Ok(())
        }
    }
}
