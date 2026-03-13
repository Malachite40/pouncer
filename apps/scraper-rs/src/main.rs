use std::{net::SocketAddr, sync::Arc};

use tokio::{net::TcpListener, signal};
use tracing::info;
use tracing_subscriber::{EnvFilter, fmt, layer::SubscriberExt, util::SubscriberInitExt};

use pounce_scraper_rs::{
    config::Settings, executor::ScrapeExecutor, http::build_router, scrape::ProductScraperFactory,
};

#[tokio::main]
async fn main() {
    init_tracing();

    let settings = Arc::new(Settings::from_env());
    let worker_factory = Arc::new(ProductScraperFactory::new(settings.clone()));
    let executor = Arc::new(ScrapeExecutor::new(settings.clone(), worker_factory));

    executor.start().await.expect("executor failed to start");

    let app = build_router(executor.clone());
    let addr = SocketAddr::from(([0, 0, 0, 0], settings.port));
    let listener = TcpListener::bind(addr)
        .await
        .expect("failed to bind rust scraper listener");

    info!(port = settings.port, "rust scraper listening");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(executor))
        .await
        .expect("rust scraper server failed");
}

fn init_tracing() {
    tracing_subscriber::registry()
        .with(
            fmt::layer()
                .json()
                .with_current_span(false)
                .with_span_list(false),
        )
        .with(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info")),
        )
        .init();
}

async fn shutdown_signal(executor: Arc<ScrapeExecutor>) {
    let _ = signal::ctrl_c().await;
    executor.shutdown().await;
}
