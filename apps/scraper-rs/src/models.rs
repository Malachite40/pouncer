use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct CheckRequest {
    pub url: String,
    #[serde(default)]
    pub css_selector: Option<String>,
    #[serde(default)]
    pub element_fingerprint: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, PartialEq, Serialize)]
pub struct CheckResponse {
    pub price: Option<f64>,
    pub stock_status: Option<String>,
    pub raw_content: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthPayload {
    pub status: String,
    pub queue_depth: usize,
    pub queue_capacity: usize,
    pub enqueue_wait_ms: u64,
    pub workers: usize,
    pub in_flight: usize,
    pub oldest_in_flight_ms: u64,
    pub stuck_workers: usize,
    pub browser_workers_total: usize,
    pub browser_workers_ready: usize,
    pub browser_restarts: usize,
    pub last_launch_error: Option<String>,
    pub last_browser_error: Option<String>,
}
