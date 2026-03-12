use std::{sync::Arc, time::Instant};

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};
use tower_http::trace::TraceLayer;
use tracing::{info, warn};

use crate::{
    executor::{ScrapeExecutor, ScrapeJobResult, ScrapeRequestError},
    models::{CheckRequest, CheckResponse},
};

#[derive(Clone)]
pub struct AppState {
    pub executor: Arc<ScrapeExecutor>,
}

pub fn build_router(executor: Arc<ScrapeExecutor>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/check", post(check))
        .with_state(AppState { executor })
        .layer(TraceLayer::new_for_http())
}

async fn health(State(state): State<AppState>) -> Response {
    let payload = state.executor.health_payload();
    if payload.status != "ok" {
        return error_response(StatusCode::SERVICE_UNAVAILABLE, json!(payload));
    }

    (StatusCode::OK, Json(payload)).into_response()
}

async fn check(State(state): State<AppState>, Json(request): Json<CheckRequest>) -> Response {
    let started_at = Instant::now();
    info!(
        url = %request.url,
        css_selector = request.css_selector.as_deref().unwrap_or(""),
        has_fingerprint = request.element_fingerprint.is_some(),
        "received scrape request"
    );

    let job = match state.executor.enqueue(request.clone()).await {
        Ok(job) => job,
        Err(err) => {
            warn!(
                url = %request.url,
                status = %err.status_code,
                detail = ?&err.detail,
                elapsed_ms = started_at.elapsed().as_millis() as u64,
                "scrape request failed"
            );
            return request_error_response(err);
        }
    };

    let result = job.wait().await;
    let elapsed_ms = started_at.elapsed().as_millis() as u64;
    if result.status_code != StatusCode::OK {
        warn!(
            url = %request.url,
            status = %result.status_code,
            detail = ?&result.detail,
            elapsed_ms,
            "scrape request failed"
        );
        return error_response(
            result.status_code,
            result
                .detail
                .unwrap_or_else(|| Value::String("unknown_error".to_string())),
        );
    }

    let payload = result.payload.unwrap_or_default();
    info!(
        price = payload.price,
        stock_status = payload.stock_status.as_deref().unwrap_or(""),
        error = payload.error.as_deref().unwrap_or(""),
        elapsed_ms,
        "scrape request completed"
    );
    (StatusCode::OK, Json(payload)).into_response()
}

fn request_error_response(err: ScrapeRequestError) -> Response {
    error_response(err.status_code, err.detail)
}

fn error_response(status: StatusCode, detail: Value) -> Response {
    (status, Json(json!({ "detail": detail }))).into_response()
}

#[allow(dead_code)]
fn _success_response(payload: CheckResponse) -> ScrapeJobResult {
    ScrapeJobResult {
        status_code: StatusCode::OK,
        payload: Some(payload),
        detail: None,
    }
}
