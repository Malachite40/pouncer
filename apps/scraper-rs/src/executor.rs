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
    sync::{Mutex, mpsc, oneshot, watch},
    task::JoinHandle,
    time::timeout,
};
use tracing::{info, warn};

use crate::{
    config::Settings,
    models::{CheckRequest, CheckResponse, HealthPayload},
    runner::{BrowserHealth, ScrapeFailure, ScrapeWorker, ScrapeWorkerFactory},
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
    browser_enabled: bool,
    ready: bool,
    restart_count: usize,
    last_launch_error: Option<String>,
    last_browser_error: Option<String>,
    in_flight_started_at: Option<Instant>,
}

pub struct ScrapeExecutor {
    settings: Arc<Settings>,
    worker_factory: Arc<dyn ScrapeWorkerFactory>,
    sender: mpsc::Sender<ScrapeJob>,
    receiver: Arc<Mutex<mpsc::Receiver<ScrapeJob>>>,
    shutdown_tx: watch::Sender<bool>,
    queue_depth: Arc<AtomicUsize>,
    worker_states: Vec<Arc<Mutex<WorkerState>>>,
    worker_tasks: Mutex<Vec<JoinHandle<()>>>,
}

impl ScrapeExecutor {
    pub fn new(settings: Arc<Settings>, worker_factory: Arc<dyn ScrapeWorkerFactory>) -> Self {
        let (sender, receiver) = mpsc::channel(settings.scrape_queue_size);
        let (shutdown_tx, _) = watch::channel(false);
        let worker_states = (0..settings.scrape_workers)
            .map(|index| {
                Arc::new(Mutex::new(WorkerState {
                    index,
                    browser_enabled: index < settings.browser_concurrency,
                    ready: index >= settings.browser_concurrency,
                    restart_count: 0,
                    last_launch_error: None,
                    last_browser_error: None,
                    in_flight_started_at: None,
                }))
            })
            .collect();

        Self {
            settings,
            worker_factory,
            sender,
            receiver: Arc::new(Mutex::new(receiver)),
            shutdown_tx,
            queue_depth: Arc::new(AtomicUsize::new(0)),
            worker_states,
            worker_tasks: Mutex::new(Vec::new()),
        }
    }

    pub async fn start(&self) -> Result<(), ScrapeRequestError> {
        let mut worker_tasks = self.worker_tasks.lock().await;
        if !worker_tasks.is_empty() {
            return Ok(());
        }

        let mut startup_rxs = Vec::new();
        for worker_state in &self.worker_states {
            let receiver = self.receiver.clone();
            let worker_factory = self.worker_factory.clone();
            let settings = self.settings.clone();
            let queue_depth = self.queue_depth.clone();
            let state = worker_state.clone();
            let mut shutdown_rx = self.shutdown_tx.subscribe();
            let (startup_tx, startup_rx) = oneshot::channel();
            startup_rxs.push(startup_rx);

            worker_tasks.push(tokio::spawn(async move {
                let index = { state.lock().await.index };
                let mut worker = worker_factory.create(index);
                if let Err(failure) = worker.start().await {
                    warn!(
                        worker_index = index,
                        error = %scrape_failure_detail(&failure),
                        "worker browser startup failed"
                    );
                }
                sync_worker_health(&state, worker.browser_health()).await;
                let _ = startup_tx.send(());

                loop {
                    let job = tokio::select! {
                        _ = shutdown_rx.changed() => None,
                        job = async {
                            let mut receiver = receiver.lock().await;
                            receiver.recv().await
                        } => job,
                    };

                    let Some(job) = job else {
                        break;
                    };

                    queue_depth.fetch_sub(1, Ordering::SeqCst);
                    {
                        let mut worker_state = state.lock().await;
                        worker_state.in_flight_started_at = Some(Instant::now());
                    }

                    info!(
                        worker_index = index,
                        url = %job.request.url,
                        queue_depth = queue_depth.load(Ordering::SeqCst),
                        waited_ms = job.enqueued_at.elapsed().as_millis() as u64,
                        "worker processing scrape"
                    );

                    let result =
                        process_job(worker.as_mut(), settings.clone(), index, &job.request).await;

                    let _ = job.response_tx.send(result);
                    sync_worker_health(&state, worker.browser_health()).await;

                    let mut worker_state = state.lock().await;
                    worker_state.in_flight_started_at = None;
                }

                worker.shutdown().await;
                sync_worker_health(&state, worker.browser_health()).await;
            }));
        }

        drop(worker_tasks);
        for startup_rx in startup_rxs {
            let _ = startup_rx.await;
        }

        info!(
            configured_workers = self.worker_states.len(),
            queue_size = self.settings.scrape_queue_size,
            browser_workers = self
                .settings
                .browser_concurrency
                .min(self.settings.scrape_workers),
            "rust scraper executor started"
        );

        Ok(())
    }

    pub async fn shutdown(&self) {
        let _ = self.shutdown_tx.send(true);
        let mut worker_tasks = self.worker_tasks.lock().await;
        for task in worker_tasks.drain(..) {
            let _ = task.await;
        }
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
        let mut browser_workers_total = 0;
        let mut browser_workers_ready = 0;
        let mut browser_restarts = 0;
        let mut last_launch_error = None;
        let mut last_browser_error = None;

        for worker_state in &self.worker_states {
            if let Ok(worker) = worker_state.try_lock() {
                if let Some(started_at) = worker.in_flight_started_at {
                    ages_ms.push(now.saturating_duration_since(started_at).as_millis() as u64);
                }
                if worker.browser_enabled {
                    browser_workers_total += 1;
                    if worker.ready {
                        browser_workers_ready += 1;
                    }
                }
                browser_restarts += worker.restart_count;
                if worker.last_launch_error.is_some() {
                    last_launch_error = worker.last_launch_error.clone();
                }
                if worker.last_browser_error.is_some() {
                    last_browser_error = worker.last_browser_error.clone();
                }
            }
        }

        let stuck_threshold_ms =
            self.settings.scrape_job_timeout_ms + self.settings.health_stuck_grace_ms;
        let stuck_workers = ages_ms
            .iter()
            .filter(|age_ms| **age_ms > stuck_threshold_ms)
            .count();
        let degraded = stuck_workers > 0
            || (browser_workers_total > 0 && browser_workers_ready < browser_workers_total);

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
            browser_workers_total,
            browser_workers_ready,
            browser_restarts,
            last_launch_error,
            last_browser_error,
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

async fn sync_worker_health(state: &Arc<Mutex<WorkerState>>, health: BrowserHealth) {
    let mut worker_state = state.lock().await;
    worker_state.ready = if worker_state.browser_enabled {
        health.ready_workers > 0
    } else {
        true
    };
    worker_state.restart_count = health.restart_count;
    worker_state.last_launch_error = health.last_launch_error;
    worker_state.last_browser_error = health.last_browser_error;
}

async fn process_job(
    worker: &mut dyn ScrapeWorker,
    settings: Arc<Settings>,
    worker_index: usize,
    request: &CheckRequest,
) -> ScrapeJobResult {
    let timed = timeout(
        Duration::from_millis(settings.scrape_job_timeout_ms),
        worker.scrape(request),
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
            worker.recycle_browser("scrape_job_timeout").await;
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

fn scrape_failure_detail(failure: &ScrapeFailure) -> &str {
    match failure {
        ScrapeFailure::Timeout(detail) | ScrapeFailure::BrowserSession(detail) => detail,
    }
}
