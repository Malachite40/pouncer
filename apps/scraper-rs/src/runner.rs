use async_trait::async_trait;

use crate::models::{CheckRequest, CheckResponse};

#[derive(Debug, Clone, Default)]
pub struct BrowserHealth {
    pub total_workers: usize,
    pub ready_workers: usize,
    pub restart_count: usize,
    pub last_launch_error: Option<String>,
}

#[derive(Debug)]
pub enum ScrapeFailure {
    Timeout(String),
    BrowserSession(String),
}

#[async_trait]
pub trait ScrapeRunner: Send + Sync {
    async fn start(&self) -> Result<(), ScrapeFailure>;
    async fn shutdown(&self);
    fn browser_health(&self) -> BrowserHealth;
    async fn scrape(&self, request: &CheckRequest) -> Result<CheckResponse, ScrapeFailure>;
}
