use std::env;

#[derive(Debug, Clone)]
pub struct Settings {
    pub port: u16,
    pub scrape_workers: usize,
    pub scrape_queue_size: usize,
    pub scrape_enqueue_wait_ms: u64,
    pub scrape_job_timeout_ms: u64,
    pub scrape_timeout_ms: u64,
    pub dynamic_wait_ms: u64,
    pub dynamic_wait_selector_state: String,
    pub dynamic_default_wait_selector: String,
    pub browser_launch_timeout_ms: u64,
    pub page_navigation_timeout_ms: u64,
    pub page_selector_timeout_ms: u64,
    pub browser_restart_attempts: usize,
    pub browser_restart_backoff_ms: u64,
    pub max_content_length: usize,
    pub health_stuck_grace_ms: u64,
    pub browser_concurrency: usize,
    pub chromedriver_path: String,
    pub chrome_binary_path: Option<String>,
    pub webdriver_port: u16,
    pub browser_user_agent: String,
    pub browser_accept_language: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            port: 8002,
            scrape_workers: 1,
            scrape_queue_size: 16,
            scrape_enqueue_wait_ms: 3_000,
            scrape_job_timeout_ms: 45_000,
            scrape_timeout_ms: 15_000,
            dynamic_wait_ms: 1_500,
            dynamic_wait_selector_state: "present".to_string(),
            dynamic_default_wait_selector: "body".to_string(),
            browser_launch_timeout_ms: 15_000,
            page_navigation_timeout_ms: 30_000,
            page_selector_timeout_ms: 5_000,
            browser_restart_attempts: 2,
            browser_restart_backoff_ms: 1_000,
            max_content_length: 5_000,
            health_stuck_grace_ms: 5_000,
            browser_concurrency: 1,
            chromedriver_path: "chromedriver".to_string(),
            chrome_binary_path: None,
            webdriver_port: 9515,
            browser_user_agent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36".to_string(),
            browser_accept_language: "en-US,en;q=0.9".to_string(),
        }
    }
}

impl Settings {
    pub fn from_env() -> Self {
        let defaults = Self::default();

        Self {
            port: env_u16("PORT").unwrap_or(defaults.port),
            scrape_workers: env_usize("SCRAPE_WORKERS").unwrap_or(defaults.scrape_workers),
            scrape_queue_size: env_usize("SCRAPE_QUEUE_SIZE").unwrap_or(defaults.scrape_queue_size),
            scrape_enqueue_wait_ms: env_u64("SCRAPE_ENQUEUE_WAIT_MS")
                .unwrap_or(defaults.scrape_enqueue_wait_ms),
            scrape_job_timeout_ms: env_u64("SCRAPE_JOB_TIMEOUT_MS")
                .unwrap_or(defaults.scrape_job_timeout_ms),
            scrape_timeout_ms: env_u64("SCRAPE_TIMEOUT_MS").unwrap_or(defaults.scrape_timeout_ms),
            dynamic_wait_ms: env_u64("DYNAMIC_WAIT_MS").unwrap_or(defaults.dynamic_wait_ms),
            dynamic_wait_selector_state: env_string("DYNAMIC_WAIT_SELECTOR_STATE")
                .unwrap_or(defaults.dynamic_wait_selector_state),
            dynamic_default_wait_selector: env_string("DYNAMIC_DEFAULT_WAIT_SELECTOR")
                .unwrap_or(defaults.dynamic_default_wait_selector),
            browser_launch_timeout_ms: env_u64("BROWSER_LAUNCH_TIMEOUT_MS")
                .unwrap_or(defaults.browser_launch_timeout_ms),
            page_navigation_timeout_ms: env_u64("PAGE_NAVIGATION_TIMEOUT_MS")
                .unwrap_or(defaults.page_navigation_timeout_ms),
            page_selector_timeout_ms: env_u64("PAGE_SELECTOR_TIMEOUT_MS")
                .unwrap_or(defaults.page_selector_timeout_ms),
            browser_restart_attempts: env_usize("BROWSER_RESTART_ATTEMPTS")
                .unwrap_or(defaults.browser_restart_attempts),
            browser_restart_backoff_ms: env_u64("BROWSER_RESTART_BACKOFF_MS")
                .unwrap_or(defaults.browser_restart_backoff_ms),
            max_content_length: env_usize("MAX_CONTENT_LENGTH")
                .unwrap_or(defaults.max_content_length),
            health_stuck_grace_ms: env_u64("HEALTH_STUCK_GRACE_MS")
                .unwrap_or(defaults.health_stuck_grace_ms),
            browser_concurrency: env_usize("BROWSER_CONCURRENCY")
                .unwrap_or(defaults.browser_concurrency),
            chromedriver_path: env_string("CHROMEDRIVER_PATH")
                .unwrap_or(defaults.chromedriver_path),
            chrome_binary_path: env_string("CHROME_BINARY_PATH"),
            webdriver_port: env_u16("WEBDRIVER_PORT").unwrap_or(defaults.webdriver_port),
            browser_user_agent: env_string("BROWSER_USER_AGENT")
                .unwrap_or(defaults.browser_user_agent),
            browser_accept_language: env_string("BROWSER_ACCEPT_LANGUAGE")
                .unwrap_or(defaults.browser_accept_language),
        }
    }

    pub fn webdriver_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.webdriver_port)
    }
}

fn env_string(key: &str) -> Option<String> {
    env::var(key).ok().filter(|value| !value.trim().is_empty())
}

fn env_u16(key: &str) -> Option<u16> {
    env_string(key)?.parse().ok()
}

fn env_u64(key: &str) -> Option<u64> {
    env_string(key)?.parse().ok()
}

fn env_usize(key: &str) -> Option<usize> {
    env_string(key)?.parse().ok()
}
