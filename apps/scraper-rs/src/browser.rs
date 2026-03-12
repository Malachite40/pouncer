use std::{
    fs, io,
    path::{Path, PathBuf},
    process::{self, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use async_trait::async_trait;
use reqwest::{Client, header};
use thirtyfour::{ChromiumLikeCapabilities, DesiredCapabilities, WebDriver};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, ChildStderr, Command},
    sync::{Mutex, Semaphore},
    time::sleep,
};
use tracing::{error, info, warn};

use crate::{config::Settings, runner::BrowserHealth, scrape::get_wait_selectors};

const CHROME_SESSION_ROOT: &str = "/tmp/pounce/sessions";
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
pub trait DynamicPageFetcher: Send + Sync {
    async fn start(&self) -> Result<(), FetchError>;
    async fn shutdown(&self);
    fn health(&self) -> BrowserHealth;
    async fn fetch(
        &self,
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
        profile_dir: SessionProfileDir,
    ) -> Result<Box<dyn BrowserSessionHandle>, FetchError>;
}

struct BrowserRuntime {
    child: Option<Box<dyn BrowserProcessHandle>>,
}

impl Default for BrowserRuntime {
    fn default() -> Self {
        Self { child: None }
    }
}

pub struct BrowserManager {
    settings: Arc<Settings>,
    engine: Arc<dyn BrowserEngine>,
    semaphore: Semaphore,
    state: Mutex<BrowserRuntime>,
    restart_count: AtomicUsize,
    last_launch_error: Mutex<Option<String>>,
    last_browser_error: Mutex<Option<String>>,
    session_ready: AtomicBool,
}

impl BrowserManager {
    pub fn new(settings: Arc<Settings>) -> Self {
        Self::with_engine(settings, Arc::new(ChromedriverEngine::default()))
    }

    fn with_engine(settings: Arc<Settings>, engine: Arc<dyn BrowserEngine>) -> Self {
        Self {
            semaphore: Semaphore::new(settings.browser_concurrency.max(1)),
            state: Mutex::new(BrowserRuntime::default()),
            restart_count: AtomicUsize::new(0),
            last_launch_error: Mutex::new(None),
            last_browser_error: Mutex::new(None),
            session_ready: AtomicBool::new(true),
            settings,
            engine,
        }
    }

    async fn ensure_running(&self) -> Result<bool, FetchError> {
        if self.settings.browser_concurrency == 0 {
            return Ok(false);
        }

        let mut state = self.state.lock().await;
        let needs_spawn = match state.child.as_mut() {
            Some(child) => child.has_exited()?,
            None => true,
        };

        if !needs_spawn {
            return Ok(true);
        }

        if state.child.take().is_some() {
            self.restart_count.fetch_add(1, Ordering::SeqCst);
        }

        let mut last_error = None;
        for attempt in 0..=self.settings.browser_restart_attempts {
            match self.engine.launch_process(self.settings.clone()).await {
                Ok(child) => {
                    state.child = Some(child);
                    *self.last_launch_error.lock().await = None;
                    return Ok(true);
                }
                Err(err) => {
                    last_error = Some(fetch_error_detail(err));
                }
            }

            if attempt < self.settings.browser_restart_attempts {
                sleep(Duration::from_millis(
                    self.settings.browser_restart_backoff_ms,
                ))
                .await;
            }
        }

        let detail = last_error.unwrap_or_else(|| "failed to launch chromedriver".to_string());
        *self.last_launch_error.lock().await = Some(detail.clone());
        Err(FetchError::BrowserSession(detail))
    }

    async fn reset_browser(&self, detail: String) {
        self.session_ready.store(false, Ordering::SeqCst);
        *self.last_browser_error.lock().await = Some(detail.clone());

        let mut state = self.state.lock().await;
        if let Some(mut child) = state.child.take() {
            self.restart_count.fetch_add(1, Ordering::SeqCst);
            if let Err(err) = child.kill().await {
                warn!(error = %err, "failed to recycle chromedriver cleanly");
            }
        }
    }

    async fn mark_session_recovered(&self) {
        self.session_ready.store(true, Ordering::SeqCst);
        *self.last_browser_error.lock().await = None;
    }

    async fn create_session(&self) -> Result<Box<dyn BrowserSessionHandle>, FetchError> {
        let profile_dir = SessionProfileDir::new(Path::new(CHROME_SESSION_ROOT))?;
        self.engine
            .create_session(self.settings.clone(), profile_dir)
            .await
    }

    async fn fetch_attempt(
        &self,
        url: &str,
        css_selector: Option<&str>,
    ) -> Result<PageFetchOutcome, FetchError> {
        let mut session = self.create_session().await?;
        let result = self
            .fetch_with_session(session.as_mut(), url, css_selector)
            .await;
        if let Err(err) = session.quit().await {
            error!(error = %err, "failed to quit webdriver session");
        }
        result
    }

    async fn fetch_with_session(
        &self,
        session: &mut dyn BrowserSessionHandle,
        url: &str,
        css_selector: Option<&str>,
    ) -> Result<PageFetchOutcome, FetchError> {
        session.goto(url).await.map_err(map_webdriver_message)?;
        self.wait_for_page_ready(session, url, css_selector).await?;
        if self.settings.dynamic_wait_ms > 0 {
            sleep(Duration::from_millis(self.settings.dynamic_wait_ms)).await;
        }
        let html = session.source().await.map_err(map_webdriver_message)?;
        Ok(PageFetchOutcome::Html(html))
    }

    async fn wait_for_page_ready(
        &self,
        session: &mut dyn BrowserSessionHandle,
        url: &str,
        css_selector: Option<&str>,
    ) -> Result<(), FetchError> {
        let selectors = get_wait_selectors(
            url,
            css_selector,
            &self.settings.dynamic_default_wait_selector,
        );
        let mut last_error = None;

        for selector in selectors {
            match wait_for_selector(
                session,
                &selector,
                Duration::from_millis(self.settings.page_selector_timeout_ms),
            )
            .await
            {
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
}

#[async_trait]
impl DynamicPageFetcher for BrowserManager {
    async fn start(&self) -> Result<(), FetchError> {
        if let Err(err) = self.ensure_running().await {
            let detail = fetch_error_detail(err);
            warn!(error = %detail, "chromedriver unavailable at startup; continuing with dynamic fallback disabled");
        }
        Ok(())
    }

    async fn shutdown(&self) {
        let mut state = self.state.lock().await;
        if let Some(mut child) = state.child.take() {
            if let Err(err) = child.kill().await {
                warn!(error = %err, "failed to stop chromedriver cleanly");
            }
        }
    }

    fn health(&self) -> BrowserHealth {
        let total_workers = self.settings.browser_concurrency;
        let running = self
            .state
            .try_lock()
            .map(|mut state| match state.child.as_mut() {
                Some(child) => match child.has_exited() {
                    Ok(false) => true,
                    Ok(true) => {
                        state.child = None;
                        false
                    }
                    Err(err) => {
                        warn!(error = %fetch_error_detail(err), "failed to inspect chromedriver process state");
                        state.child = None;
                        false
                    }
                },
                None => false,
            })
            .unwrap_or(false);

        let ready_workers =
            if total_workers > 0 && running && self.session_ready.load(Ordering::SeqCst) {
                total_workers
            } else {
                0
            };

        BrowserHealth {
            total_workers,
            ready_workers,
            restart_count: self.restart_count.load(Ordering::SeqCst),
            last_launch_error: self
                .last_launch_error
                .try_lock()
                .ok()
                .and_then(|detail| detail.clone()),
            last_browser_error: self
                .last_browser_error
                .try_lock()
                .ok()
                .and_then(|detail| detail.clone()),
        }
    }

    async fn fetch(
        &self,
        url: &str,
        css_selector: Option<&str>,
    ) -> Result<PageFetchOutcome, FetchError> {
        let _permit = self
            .semaphore
            .acquire()
            .await
            .map_err(|err| FetchError::BrowserSession(err.to_string()))?;

        for attempt in 0..2 {
            if !self.ensure_running().await? {
                return Err(FetchError::BrowserSession(
                    "dynamic browser support is disabled".to_string(),
                ));
            }

            match self.fetch_attempt(url, css_selector).await {
                Ok(outcome) => {
                    self.mark_session_recovered().await;
                    return Ok(outcome);
                }
                Err(FetchError::BrowserSession(detail)) => {
                    warn!(
                        attempt = attempt + 1,
                        error = %detail,
                        "browser session failed; recycling chromedriver"
                    );
                    self.reset_browser(detail.clone()).await;
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
        profile_dir: SessionProfileDir,
    ) -> Result<Box<dyn BrowserSessionHandle>, FetchError> {
        let mut capabilities = DesiredCapabilities::chrome();
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

        let driver = WebDriver::new(&settings.webdriver_url(), capabilities)
            .await
            .map_err(map_webdriver_error)?;

        Ok(Box::new(RealBrowserSession {
            driver: Some(driver),
            _profile_dir: profile_dir,
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
    _profile_dir: SessionProfileDir,
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

fn map_webdriver_message(message: String) -> FetchError {
    let normalized = message.to_lowercase();
    if normalized.contains("timeout") {
        return FetchError::Timeout(format!("Page timeout: {message}"));
    }
    if is_browser_session_message(&normalized) {
        return FetchError::BrowserSession(message);
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
            FakeSessionPlan::Html("<html><body>ok</body></html>".to_string()),
        ]));
        let manager = BrowserManager::with_engine(settings, engine.clone());

        let result = manager
            .fetch("https://example.com/product", Some("body"))
            .await
            .expect("fetch should recover");

        assert!(matches!(result, PageFetchOutcome::Html(_)));
        assert_eq!(engine.launch_calls(), 2);
        assert_eq!(engine.killed_processes(), vec![0]);

        let health = manager.health();
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
        let manager = BrowserManager::with_engine(settings, engine.clone());

        let err = manager
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

        let health = manager.health();
        assert_eq!(health.total_workers, 1);
        assert_eq!(health.ready_workers, 0);
        assert_eq!(health.restart_count, 2);
        assert_eq!(
            health.last_browser_error.as_deref(),
            Some("chrome not reachable")
        );
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
                    killed_processes: StdMutex::new(Vec::new()),
                    session_plans: StdMutex::new(session_plans.into()),
                }),
            }
        }

        fn launch_calls(&self) -> usize {
            self.state.launch_calls.load(Ordering::SeqCst)
        }

        fn killed_processes(&self) -> Vec<usize> {
            self.state.killed_processes.lock().unwrap().clone()
        }
    }

    struct FakeBrowserEngineState {
        next_process_id: AtomicUsize,
        launch_calls: AtomicUsize,
        killed_processes: StdMutex<Vec<usize>>,
        session_plans: StdMutex<VecDeque<FakeSessionPlan>>,
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
            profile_dir: SessionProfileDir,
        ) -> Result<Box<dyn BrowserSessionHandle>, FetchError> {
            match self
                .state
                .session_plans
                .lock()
                .unwrap()
                .pop_front()
                .expect("session plan")
            {
                FakeSessionPlan::CreateError(err) => Err(err),
                FakeSessionPlan::Html(html) => Ok(Box::new(FakeSessionHandle {
                    html,
                    _profile_dir: profile_dir,
                })),
            }
        }
    }

    enum FakeSessionPlan {
        CreateError(FetchError),
        Html(String),
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

    struct FakeSessionHandle {
        html: String,
        _profile_dir: SessionProfileDir,
    }

    #[async_trait]
    impl BrowserSessionHandle for FakeSessionHandle {
        async fn goto(&mut self, _url: &str) -> Result<(), String> {
            Ok(())
        }

        async fn source(&mut self) -> Result<String, String> {
            Ok(self.html.clone())
        }

        async fn find(&mut self, _selector: &str) -> Result<(), String> {
            Ok(())
        }

        async fn quit(&mut self) -> Result<(), String> {
            Ok(())
        }
    }
}
