use std::sync::{
    Arc,
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
    runner::{BrowserHealth, ScrapeFailure, ScrapeRunner},
};
use serde_json::{Value, json};
use tokio::{sync::Notify, time::Duration};
use tower::ServiceExt;

struct FakeRunner {
    health: BrowserHealth,
    response: FakeRunnerResponse,
    starts: AtomicUsize,
}

enum FakeRunnerResponse {
    Success(CheckResponse),
    Timeout(String),
    BlockingSuccess {
        started: Arc<Notify>,
        release: Arc<Notify>,
        payload: CheckResponse,
    },
}

#[async_trait]
impl ScrapeRunner for FakeRunner {
    async fn start(&self) -> Result<(), ScrapeFailure> {
        self.starts.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }

    async fn shutdown(&self) {}

    fn browser_health(&self) -> BrowserHealth {
        self.health.clone()
    }

    async fn scrape(&self, _request: &CheckRequest) -> Result<CheckResponse, ScrapeFailure> {
        match &self.response {
            FakeRunnerResponse::Success(payload) => Ok(payload.clone()),
            FakeRunnerResponse::Timeout(detail) => Err(ScrapeFailure::Timeout(detail.clone())),
            FakeRunnerResponse::BlockingSuccess {
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
    let runner = Arc::new(FakeRunner {
        health: BrowserHealth {
            total_workers: 1,
            ready_workers: 0,
            restart_count: 2,
            last_launch_error: Some("boom".to_string()),
        },
        response: FakeRunnerResponse::Success(CheckResponse::default()),
        starts: AtomicUsize::new(0),
    });
    let executor = Arc::new(ScrapeExecutor::new(settings, runner));
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

    executor.shutdown().await;
}

#[tokio::test]
async fn check_returns_success_payload() {
    let settings = Arc::new(Settings::default());
    let runner = Arc::new(FakeRunner {
        health: BrowserHealth::default(),
        response: FakeRunnerResponse::Success(CheckResponse {
            price: Some(42.5),
            stock_status: Some("in_stock".to_string()),
            raw_content: Some("ok".to_string()),
            error: None,
        }),
        starts: AtomicUsize::new(0),
    });
    let executor = Arc::new(ScrapeExecutor::new(settings, runner));
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
    let runner = Arc::new(FakeRunner {
        health: BrowserHealth::default(),
        response: FakeRunnerResponse::Timeout("scrape_job_timeout".to_string()),
        starts: AtomicUsize::new(0),
    });
    let executor = Arc::new(ScrapeExecutor::new(settings, runner));
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
async fn check_rejects_when_queue_is_full() {
    let mut settings = Settings::default();
    settings.scrape_workers = 1;
    settings.scrape_queue_size = 1;
    settings.scrape_enqueue_wait_ms = 50;
    settings.scrape_job_timeout_ms = 5_000;
    let settings = Arc::new(settings);

    let started = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let runner = Arc::new(FakeRunner {
        health: BrowserHealth::default(),
        response: FakeRunnerResponse::BlockingSuccess {
            started: started.clone(),
            release: release.clone(),
            payload: CheckResponse::default(),
        },
        starts: AtomicUsize::new(0),
    });
    let executor = Arc::new(ScrapeExecutor::new(settings, runner));
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
