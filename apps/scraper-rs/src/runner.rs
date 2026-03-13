use async_trait::async_trait;

use crate::models::{CheckRequest, CheckResponse};

#[derive(Debug, Clone, Default)]
pub struct BrowserHealth {
    pub total_workers: usize,
    pub ready_workers: usize,
    pub restart_count: usize,
    pub last_launch_error: Option<String>,
    pub last_browser_error: Option<String>,
}

#[derive(Debug)]
pub enum ScrapeFailure {
    Timeout(String),
    BrowserSession(String),
}

#[async_trait]
pub trait ScrapeWorker: Send {
    async fn start(&mut self) -> Result<(), ScrapeFailure>;
    async fn shutdown(&mut self);
    fn browser_health(&self) -> BrowserHealth;
    async fn recycle_browser(&mut self, reason: &str);
    async fn scrape(&mut self, request: &CheckRequest) -> Result<CheckResponse, ScrapeFailure>;
}

pub trait ScrapeWorkerFactory: Send + Sync {
    fn create(&self, worker_index: usize) -> Box<dyn ScrapeWorker>;
}
