use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use axum::http::StatusCode;
use serde_json::{Value, json};
use tokio::{
    sync::{Mutex, mpsc, oneshot},
    task::JoinHandle,
    time::timeout,
};
use tracing::{info, warn};

use crate::{
    config::Settings,
    models::{CheckRequest, CheckResponse, HealthPayload},
    runner::{ScrapeFailure, ScrapeRunner},
};

#[derive(Debug)]
pub struct ScrapeRequestError {
    pub status_code: StatusCode,
    pub detail: Value,
}

#[derive(Debug, Clone)]
pub struct ScrapeJobResult {
    pub status_code: StatusCode,
    pub payload: Option<CheckResponse>,
    pub detail: Option<Value>,
}

struct ScrapeJob {
    request: CheckRequest,
    enqueued_at: Instant,
    response_tx: oneshot::Sender<ScrapeJobResult>,
}

pub struct ScrapeJobHandle {
    response_rx: oneshot::Receiver<ScrapeJobResult>,
}

impl ScrapeJobHandle {
    pub async fn wait(self) -> ScrapeJobResult {
        self.response_rx.await.unwrap_or(ScrapeJobResult {
            status_code: StatusCode::SERVICE_UNAVAILABLE,
            payload: None,
            detail: Some(json!({
                "status": "degraded",
                "reason": "worker_crash",
            })),
        })
    }
}

struct WorkerState {
    index: usize,
    in_flight_started_at: Option<Instant>,
}

pub struct ScrapeExecutor {
    settings: Arc<Settings>,
    runner: Arc<dyn ScrapeRunner>,
    sender: mpsc::Sender<ScrapeJob>,
    receiver: Arc<Mutex<mpsc::Receiver<ScrapeJob>>>,
    queue_depth: Arc<AtomicUsize>,
    worker_states: Vec<Arc<Mutex<WorkerState>>>,
    worker_tasks: Mutex<Vec<JoinHandle<()>>>,
}

impl ScrapeExecutor {
    pub fn new(settings: Arc<Settings>, runner: Arc<dyn ScrapeRunner>) -> Self {
        let (sender, receiver) = mpsc::channel(settings.scrape_queue_size);
        let worker_states = (0..settings.scrape_workers)
            .map(|index| {
                Arc::new(Mutex::new(WorkerState {
                    index,
                    in_flight_started_at: None,
                }))
            })
            .collect();

        Self {
            settings,
            runner,
            sender,
            receiver: Arc::new(Mutex::new(receiver)),
            queue_depth: Arc::new(AtomicUsize::new(0)),
            worker_states,
            worker_tasks: Mutex::new(Vec::new()),
        }
    }

    pub async fn start(&self) -> Result<(), ScrapeRequestError> {
        self.runner
            .start()
            .await
            .map_err(|failure| ScrapeRequestError {
                status_code: StatusCode::SERVICE_UNAVAILABLE,
                detail: self.service_detail(
                    "scrape_runner_start_failed",
                    None,
                    None,
                    Some(match failure {
                        ScrapeFailure::Timeout(detail) | ScrapeFailure::BrowserSession(detail) => {
                            detail
                        }
                    }),
                ),
            })?;

        let mut worker_tasks = self.worker_tasks.lock().await;
        if !worker_tasks.is_empty() {
            return Ok(());
        }

        for worker_state in &self.worker_states {
            let receiver = self.receiver.clone();
            let runner = self.runner.clone();
            let settings = self.settings.clone();
            let queue_depth = self.queue_depth.clone();
            let state = worker_state.clone();
            worker_tasks.push(tokio::spawn(async move {
                loop {
                    let job = {
                        let mut receiver = receiver.lock().await;
                        receiver.recv().await
                    };

                    let Some(job) = job else {
                        break;
                    };

                    queue_depth.fetch_sub(1, Ordering::SeqCst);
                    let index = {
                        let mut worker = state.lock().await;
                        worker.in_flight_started_at = Some(Instant::now());
                        worker.index
                    };

                    info!(worker_index = index, url = %job.request.url, queue_depth = queue_depth.load(Ordering::SeqCst), waited_ms = job.enqueued_at.elapsed().as_millis() as u64, "worker processing scrape");

                    let result = process_job(
                        runner.clone(),
                        settings.clone(),
                        index,
                        &job.request,
                    )
                    .await;

                    let _ = job.response_tx.send(result);

                    let mut worker = state.lock().await;
                    worker.in_flight_started_at = None;
                }
            }));
        }

        info!(
            configured_workers = self.worker_states.len(),
            queue_size = self.settings.scrape_queue_size,
            "rust scraper executor started"
        );

        Ok(())
    }

    pub async fn shutdown(&self) {
        let mut worker_tasks = self.worker_tasks.lock().await;
        for task in worker_tasks.iter() {
            task.abort();
        }
        worker_tasks.clear();
        self.runner.shutdown().await;
    }

    pub async fn enqueue(
        &self,
        request: CheckRequest,
    ) -> Result<ScrapeJobHandle, ScrapeRequestError> {
        let (response_tx, response_rx) = oneshot::channel();
        let job = ScrapeJob {
            request: request.clone(),
            enqueued_at: Instant::now(),
            response_tx,
        };

        timeout(
            Duration::from_millis(self.settings.scrape_enqueue_wait_ms),
            self.sender.send(job),
        )
        .await
        .map_err(|_| ScrapeRequestError {
            status_code: StatusCode::SERVICE_UNAVAILABLE,
            detail: self.service_detail(
                "queue_full",
                Some(request.url.as_str()),
                Some(self.queue_depth.load(Ordering::SeqCst)),
                None,
            ),
        })?
        .map_err(|_| ScrapeRequestError {
            status_code: StatusCode::SERVICE_UNAVAILABLE,
            detail: self.service_detail(
                "executor_closed",
                Some(request.url.as_str()),
                Some(self.queue_depth.load(Ordering::SeqCst)),
                None,
            ),
        })?;

        self.queue_depth.fetch_add(1, Ordering::SeqCst);
        Ok(ScrapeJobHandle { response_rx })
    }

    pub fn health_payload(&self) -> HealthPayload {
        let now = Instant::now();
        let mut ages_ms = Vec::new();
        for worker_state in &self.worker_states {
            if let Ok(worker) = worker_state.try_lock() {
                if let Some(started_at) = worker.in_flight_started_at {
                    ages_ms.push(now.saturating_duration_since(started_at).as_millis() as u64);
                }
            }
        }

        let stuck_threshold_ms =
            self.settings.scrape_job_timeout_ms + self.settings.health_stuck_grace_ms;
        let stuck_workers = ages_ms
            .iter()
            .filter(|age_ms| **age_ms > stuck_threshold_ms)
            .count();
        let browser_health = self.runner.browser_health();
        let degraded = stuck_workers > 0
            || (browser_health.total_workers > 0
                && browser_health.ready_workers < browser_health.total_workers);

        HealthPayload {
            status: if degraded {
                "degraded".to_string()
            } else {
                "ok".to_string()
            },
            queue_depth: self.queue_depth.load(Ordering::SeqCst),
            queue_capacity: self.settings.scrape_queue_size,
            enqueue_wait_ms: self.settings.scrape_enqueue_wait_ms,
            workers: self.worker_states.len(),
            in_flight: ages_ms.len(),
            oldest_in_flight_ms: ages_ms.into_iter().max().unwrap_or_default(),
            stuck_workers,
            browser_workers_total: browser_health.total_workers,
            browser_workers_ready: browser_health.ready_workers,
            browser_restarts: browser_health.restart_count,
            last_launch_error: browser_health.last_launch_error,
        }
    }

    fn service_detail(
        &self,
        reason: &str,
        url: Option<&str>,
        queue_depth: Option<usize>,
        error: Option<String>,
    ) -> Value {
        let mut detail = json!({
            "status": "degraded",
            "reason": reason,
        });
        if let Some(url) = url {
            detail["url"] = json!(url);
        }
        if let Some(queue_depth) = queue_depth {
            detail["queue_depth"] = json!(queue_depth);
        }
        if let Some(error) = error {
            detail["error"] = json!(error);
        }
        detail
    }
}

async fn process_job(
    runner: Arc<dyn ScrapeRunner>,
    settings: Arc<Settings>,
    worker_index: usize,
    request: &CheckRequest,
) -> ScrapeJobResult {
    let timed = timeout(
        Duration::from_millis(settings.scrape_job_timeout_ms),
        runner.scrape(request),
    )
    .await;

    match timed {
        Ok(Ok(payload)) => ScrapeJobResult {
            status_code: StatusCode::OK,
            payload: Some(payload),
            detail: None,
        },
        Ok(Err(ScrapeFailure::Timeout(detail))) => ScrapeJobResult {
            status_code: StatusCode::GATEWAY_TIMEOUT,
            payload: None,
            detail: Some(timeout_detail(&detail, request.url.as_str(), worker_index)),
        },
        Ok(Err(ScrapeFailure::BrowserSession(detail))) => ScrapeJobResult {
            status_code: StatusCode::SERVICE_UNAVAILABLE,
            payload: None,
            detail: Some(service_detail(
                "browser_restart_required",
                request.url.as_str(),
                worker_index,
                Some(detail),
            )),
        },
        Err(_) => {
            warn!(worker_index = worker_index, url = %request.url, "scrape job timed out");
            ScrapeJobResult {
                status_code: StatusCode::GATEWAY_TIMEOUT,
                payload: None,
                detail: Some(timeout_detail(
                    "scrape_job_timeout",
                    request.url.as_str(),
                    worker_index,
                )),
            }
        }
    }
}

fn service_detail(reason: &str, url: &str, worker_index: usize, error: Option<String>) -> Value {
    let mut detail = json!({
        "status": "degraded",
        "reason": reason,
        "url": url,
        "worker_index": worker_index,
    });
    if let Some(error) = error {
        detail["error"] = json!(error);
    }
    detail
}

fn timeout_detail(reason: &str, url: &str, worker_index: usize) -> Value {
    json!({
        "status": "timeout",
        "reason": reason,
        "url": url,
        "worker_index": worker_index,
    })
}
