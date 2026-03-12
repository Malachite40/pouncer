use std::{
    process::Stdio,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use async_trait::async_trait;
use reqwest::{Client, header};
use thirtyfour::{By, ChromiumLikeCapabilities, DesiredCapabilities, WebDriver};
use tokio::{
    process::{Child, Command},
    sync::{Mutex, Semaphore},
    time::sleep,
};
use tracing::{error, info, warn};

use crate::{config::Settings, runner::BrowserHealth, scrape::get_wait_selectors};

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

#[derive(Default)]
struct BrowserRuntime {
    child: Option<Child>,
}

pub struct BrowserManager {
    settings: Arc<Settings>,
    semaphore: Semaphore,
    state: Mutex<BrowserRuntime>,
    client: Client,
    restart_count: AtomicUsize,
    last_launch_error: Mutex<Option<String>>,
}

impl BrowserManager {
    pub fn new(settings: Arc<Settings>) -> Self {
        Self {
            semaphore: Semaphore::new(settings.browser_concurrency.max(1)),
            state: Mutex::new(BrowserRuntime::default()),
            client: Client::new(),
            restart_count: AtomicUsize::new(0),
            last_launch_error: Mutex::new(None),
            settings,
        }
    }

    async fn ensure_running(&self) -> Result<bool, FetchError> {
        if self.settings.browser_concurrency == 0 {
            return Ok(false);
        }

        let mut state = self.state.lock().await;
        let needs_spawn = match state.child.as_mut() {
            Some(child) => child
                .try_wait()
                .map_err(|err| FetchError::BrowserSession(err.to_string()))?
                .is_some(),
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
            match self.spawn_process().await {
                Ok(child) => {
                    state.child = Some(child);
                    drop(state);
                    match self.wait_until_ready().await {
                        Ok(()) => {
                            *self.last_launch_error.lock().await = None;
                            return Ok(true);
                        }
                        Err(err) => {
                            last_error = Some(match err {
                                FetchError::Timeout(detail)
                                | FetchError::BrowserSession(detail)
                                | FetchError::Unexpected(detail) => detail,
                            });
                            state = self.state.lock().await;
                            if let Some(child) = state.child.as_mut() {
                                let _ = child.kill().await;
                            }
                            state.child = None;
                        }
                    }
                }
                Err(err) => {
                    last_error = Some(match err {
                        FetchError::Timeout(detail)
                        | FetchError::BrowserSession(detail)
                        | FetchError::Unexpected(detail) => detail,
                    });
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

    async fn spawn_process(&self) -> Result<Child, FetchError> {
        let mut command = Command::new(&self.settings.chromedriver_path);
        command
            .arg(format!("--port={}", self.settings.webdriver_port))
            .arg("--allowed-ips=")
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        let child = command.spawn().map_err(|err| {
            FetchError::BrowserSession(format!("failed to spawn chromedriver: {err}"))
        })?;
        info!("chromedriver started");
        Ok(child)
    }

    async fn wait_until_ready(&self) -> Result<(), FetchError> {
        let deadline =
            Instant::now() + Duration::from_millis(self.settings.browser_launch_timeout_ms);
        let status_url = format!("{}/status", self.settings.webdriver_url());

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

    async fn create_driver(&self) -> Result<WebDriver, FetchError> {
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
        let language_arg = format!("--lang={}", self.settings.browser_accept_language);
        capabilities
            .add_arg(&language_arg)
            .map_err(map_browser_capability_error)?;
        let user_agent_arg = format!("--user-agent={}", self.settings.browser_user_agent);
        capabilities
            .add_arg(&user_agent_arg)
            .map_err(map_browser_capability_error)?;
        if let Some(binary) = self.settings.chrome_binary_path.as_deref() {
            capabilities
                .set_binary(binary)
                .map_err(map_browser_capability_error)?;
        }

        WebDriver::new(&self.settings.webdriver_url(), capabilities)
            .await
            .map_err(map_webdriver_error)
    }

    async fn fetch_with_driver(
        &self,
        driver: &WebDriver,
        url: &str,
        css_selector: Option<&str>,
    ) -> Result<PageFetchOutcome, FetchError> {
        driver.goto(url).await.map_err(map_webdriver_error)?;
        self.wait_for_page_ready(driver, url, css_selector).await?;
        if self.settings.dynamic_wait_ms > 0 {
            sleep(Duration::from_millis(self.settings.dynamic_wait_ms)).await;
        }
        let html = driver.source().await.map_err(map_webdriver_error)?;
        Ok(PageFetchOutcome::Html(html))
    }

    async fn wait_for_page_ready(
        &self,
        driver: &WebDriver,
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
                driver,
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
            let detail = match err {
                FetchError::Timeout(detail)
                | FetchError::BrowserSession(detail)
                | FetchError::Unexpected(detail) => detail,
            };
            warn!(error = %detail, "chromedriver unavailable at startup; continuing with dynamic fallback disabled");
        }
        Ok(())
    }

    async fn shutdown(&self) {
        let mut state = self.state.lock().await;
        if let Some(child) = state.child.as_mut() {
            if let Err(err) = child.kill().await {
                warn!(error = %err, "failed to stop chromedriver cleanly");
            }
        }
        state.child = None;
    }

    fn health(&self) -> BrowserHealth {
        let running = self
            .state
            .try_lock()
            .map(|state| state.child.is_some())
            .unwrap_or(false);
        let workers = if running {
            self.settings.browser_concurrency
        } else {
            0
        };

        BrowserHealth {
            total_workers: workers,
            ready_workers: workers,
            restart_count: self.restart_count.load(Ordering::SeqCst),
            last_launch_error: self
                .last_launch_error
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
        if !self.ensure_running().await? {
            return Err(FetchError::BrowserSession(
                "dynamic browser support is disabled".to_string(),
            ));
        }

        let _permit = self
            .semaphore
            .acquire()
            .await
            .map_err(|err| FetchError::BrowserSession(err.to_string()))?;
        let driver = self.create_driver().await?;
        let result = self.fetch_with_driver(&driver, url, css_selector).await;
        if let Err(err) = driver.quit().await {
            error!(error = %err, "failed to quit webdriver session");
        }
        result
    }
}

async fn wait_for_selector(
    driver: &WebDriver,
    selector: &str,
    timeout: Duration,
) -> Result<(), FetchError> {
    let deadline = Instant::now() + timeout;
    let by = By::Css(selector.to_string());

    loop {
        match driver.find(by.clone()).await {
            Ok(_) => return Ok(()),
            Err(err) => {
                let message = err.to_string();
                let normalized = message.to_lowercase();
                if normalized.contains("invalid selector") {
                    return Err(FetchError::Unexpected(message));
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
    let message = err.to_string();
    let normalized = message.to_lowercase();
    if normalized.contains("timeout") {
        return FetchError::Timeout(format!("Page timeout: {message}"));
    }
    if normalized.contains("connection refused")
        || normalized.contains("session not created")
        || normalized.contains("browser has been closed")
        || normalized.contains("target frame detached")
        || normalized.contains("chrome not reachable")
    {
        return FetchError::BrowserSession(message);
    }
    FetchError::Unexpected(message)
}
