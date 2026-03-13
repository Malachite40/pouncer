use std::sync::{
    Arc, Mutex as StdMutex,
    atomic::{AtomicUsize, Ordering},
};

use async_trait::async_trait;
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use pounce_scraper_rs::{
    config::Settings,
    executor::ScrapeExecutor,
    http::build_router,
    models::{CheckRequest, CheckResponse},
    runner::{BrowserHealth, ScrapeFailure, ScrapeWorker, ScrapeWorkerFactory},
};
use serde_json::{Value, json};
use tokio::{sync::Notify, time::Duration};
use tower::ServiceExt;

struct FakeWorkerFactory {
    state: Arc<FakeWorkerState>,
    response: FakeWorkerResponse,
}

#[derive(Clone)]
enum FakeWorkerResponse {
    Success(CheckResponse),
    Timeout(String),
    BrowserSession(String),
    BlockingSuccess {
        started: Arc<Notify>,
        release: Arc<Notify>,
        payload: CheckResponse,
    },
}

struct FakeWorkerState {
    health: StdMutex<BrowserHealth>,
    starts: AtomicUsize,
    recycle_calls: AtomicUsize,
}

impl FakeWorkerFactory {
    fn new(health: BrowserHealth, response: FakeWorkerResponse) -> Self {
        Self {
            state: Arc::new(FakeWorkerState {
                health: StdMutex::new(health),
                starts: AtomicUsize::new(0),
                recycle_calls: AtomicUsize::new(0),
            }),
            response,
        }
    }
}

impl ScrapeWorkerFactory for FakeWorkerFactory {
    fn create(&self, _worker_index: usize) -> Box<dyn ScrapeWorker> {
        Box::new(FakeWorker {
            state: self.state.clone(),
            response: self.response.clone(),
        })
    }
}

struct FakeWorker {
    state: Arc<FakeWorkerState>,
    response: FakeWorkerResponse,
}

#[async_trait]
impl ScrapeWorker for FakeWorker {
    async fn start(&mut self) -> Result<(), ScrapeFailure> {
        self.state.starts.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn shutdown(&mut self) {}

    fn browser_health(&self) -> BrowserHealth {
        self.state.health.lock().unwrap().clone()
    }

    async fn recycle_browser(&mut self, reason: &str) {
        self.state.recycle_calls.fetch_add(1, Ordering::SeqCst);
        let mut health = self.state.health.lock().unwrap();
        health.ready_workers = 0;
        health.restart_count += 1;
        health.last_browser_error = Some(reason.to_string());
    }

    async fn scrape(&mut self, _request: &CheckRequest) -> Result<CheckResponse, ScrapeFailure> {
        match &self.response {
            FakeWorkerResponse::Success(payload) => Ok(payload.clone()),
            FakeWorkerResponse::Timeout(detail) => Err(ScrapeFailure::Timeout(detail.clone())),
            FakeWorkerResponse::BrowserSession(detail) => {
                Err(ScrapeFailure::BrowserSession(detail.clone()))
            }
            FakeWorkerResponse::BlockingSuccess {
                started,
                release,
                payload,
            } => {
                started.notify_waiters();
                release.notified().await;
                Ok(payload.clone())
            }
        }
    }
}

#[tokio::test]
async fn health_reports_degraded_executor_payload() {
    let settings = Arc::new(Settings::default());
    let worker_factory = Arc::new(FakeWorkerFactory::new(
        BrowserHealth {
            total_workers: 1,
            ready_workers: 0,
            restart_count: 2,
            last_launch_error: Some("boom".to_string()),
            last_browser_error: Some("session not created".to_string()),
        },
        FakeWorkerResponse::Success(CheckResponse::default()),
    ));
    let executor = Arc::new(ScrapeExecutor::new(settings, worker_factory));
    executor.start().await.expect("executor start");
    let app = build_router(executor.clone());

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("health response");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["detail"]["browser_workers_ready"], 0);
    assert_eq!(payload["detail"]["last_launch_error"], "boom");
    assert_eq!(
        payload["detail"]["last_browser_error"],
        "session not created"
    );

    executor.shutdown().await;
}

#[tokio::test]
async fn check_returns_success_payload() {
    let settings = Arc::new(Settings::default());
    let worker_factory = Arc::new(FakeWorkerFactory::new(
        BrowserHealth::default(),
        FakeWorkerResponse::Success(CheckResponse {
            price: Some(42.5),
            stock_status: Some("in_stock".to_string()),
            raw_content: Some("ok".to_string()),
            error: None,
        }),
    ));
    let executor = Arc::new(ScrapeExecutor::new(settings, worker_factory));
    executor.start().await.expect("executor start");
    let app = build_router(executor.clone());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/check")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "url": "https://example.com/product" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .expect("check response");

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: CheckResponse = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload.price, Some(42.5));
    assert_eq!(payload.stock_status.as_deref(), Some("in_stock"));

    executor.shutdown().await;
}

#[tokio::test]
async fn check_propagates_timeout_status() {
    let settings = Arc::new(Settings::default());
    let worker_factory = Arc::new(FakeWorkerFactory::new(
        BrowserHealth::default(),
        FakeWorkerResponse::Timeout("scrape_job_timeout".to_string()),
    ));
    let executor = Arc::new(ScrapeExecutor::new(settings, worker_factory));
    executor.start().await.expect("executor start");
    let app = build_router(executor.clone());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/check")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "url": "https://example.com/product" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .expect("check response");

    assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["detail"]["status"], "timeout");

    executor.shutdown().await;
}

#[tokio::test]
async fn check_propagates_browser_session_status() {
    let settings = Arc::new(Settings::default());
    let worker_factory = Arc::new(FakeWorkerFactory::new(
        BrowserHealth {
            total_workers: 1,
            ready_workers: 0,
            restart_count: 1,
            last_launch_error: None,
            last_browser_error: Some("chrome not reachable".to_string()),
        },
        FakeWorkerResponse::BrowserSession("chrome not reachable".to_string()),
    ));
    let executor = Arc::new(ScrapeExecutor::new(settings, worker_factory));
    executor.start().await.expect("executor start");
    let app = build_router(executor.clone());

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/check")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "url": "https://example.com/product" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .expect("check response");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["detail"]["reason"], "browser_restart_required");

    executor.shutdown().await;
}

#[tokio::test]
async fn outer_timeout_recycles_browser_and_marks_health_degraded() {
    let mut settings = Settings::default();
    settings.scrape_workers = 1;
    settings.scrape_job_timeout_ms = 5;
    let settings = Arc::new(settings);

    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let worker_factory = Arc::new(FakeWorkerFactory::new(
        BrowserHealth {
            total_workers: 1,
            ready_workers: 1,
            restart_count: 0,
            last_launch_error: None,
            last_browser_error: None,
        },
        FakeWorkerResponse::BlockingSuccess {
            started: started.clone(),
            release: release.clone(),
            payload: CheckResponse::default(),
        },
    ));
    let worker_state = worker_factory.state.clone();

    let executor = Arc::new(ScrapeExecutor::new(settings, worker_factory));
    executor.start().await.expect("executor start");
    let app = build_router(executor.clone());

    let response_task = tokio::spawn({
        let app = app.clone();
        async move {
            app.oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/check")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({ "url": "https://example.com/product" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap()
        }
    });

    started.notified().await;
    let response = response_task.await.unwrap();
    assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
    assert_eq!(worker_state.recycle_calls.load(Ordering::SeqCst), 1);

    let health_response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("health response");

    assert_eq!(health_response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(health_response.into_body(), usize::MAX)
        .await
        .unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["detail"]["browser_workers_ready"], 0);
    assert_eq!(
        payload["detail"]["last_browser_error"],
        "scrape_job_timeout"
    );

    release.notify_waiters();
    executor.shutdown().await;
}

#[tokio::test]
async fn check_rejects_when_queue_is_full() {
    let mut settings = Settings::default();
    settings.scrape_workers = 1;
    settings.scrape_queue_size = 1;
    settings.scrape_enqueue_wait_ms = 50;
    settings.scrape_job_timeout_ms = 5_000;
    let settings = Arc::new(settings);

    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let worker_factory = Arc::new(FakeWorkerFactory::new(
        BrowserHealth::default(),
        FakeWorkerResponse::BlockingSuccess {
            started: started.clone(),
            release: release.clone(),
            payload: CheckResponse::default(),
        },
    ));
    let executor = Arc::new(ScrapeExecutor::new(settings, worker_factory));
    executor.start().await.expect("executor start");
    let app = build_router(executor.clone());

    let request_body = json!({ "url": "https://example.com/product" }).to_string();

    let first = tokio::spawn({
        let app = app.clone();
        let request_body = request_body.clone();
        async move {
            app.oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/check")
                    .header("content-type", "application/json")
                    .body(Body::from(request_body))
                    .unwrap(),
            )
            .await
            .unwrap()
        }
    });

    started.notified().await;

    let second = tokio::spawn({
        let app = app.clone();
        let request_body = request_body.clone();
        async move {
            app.oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/check")
                    .header("content-type", "application/json")
                    .body(Body::from(request_body))
                    .unwrap(),
            )
            .await
            .unwrap()
        }
    });

    tokio::time::sleep(Duration::from_millis(10)).await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/check")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "url": "https://example.com/product" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .expect("third response");

    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let payload: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(payload["detail"]["reason"], "queue_full");

    release.notify_waiters();
    let _ = first.await.unwrap();
    let _ = second.await.unwrap();
    executor.shutdown().await;
}
