use std::sync::Arc;

use async_trait::async_trait;
use scraper::Html;
use url::Url;

use crate::{
    browser::{
        BrowserWorker, DynamicPageFetcher, FetchError, HttpStaticFetcher, PageFetchOutcome,
        StaticPageFetcher,
    },
    config::Settings,
    hosts::extract_host_specific,
    json_ld::extract_json_ld,
    models::{CheckRequest, CheckResponse},
    parsing::{ExtractionResult, validate_price},
    runner::{BrowserHealth, ScrapeFailure, ScrapeWorker, ScrapeWorkerFactory},
    strategies::{
        extract_common_selectors, extract_css_selector, extract_fingerprint, extract_meta_price,
        extract_title_window,
    },
};

const SOURCE_STATIC: &str = "scrapling-static";
const SOURCE_DYNAMIC: &str = "scrapling-dynamic";

pub struct ProductScraper {
    settings: Arc<Settings>,
    static_fetcher: Arc<dyn StaticPageFetcher>,
    dynamic_fetcher: Box<dyn DynamicPageFetcher>,
}

impl ProductScraper {
    pub fn new(settings: Arc<Settings>, dynamic_enabled: bool) -> Self {
        let static_fetcher = Arc::new(HttpStaticFetcher::new(settings.clone()));
        let dynamic_fetcher = Box::new(BrowserWorker::new(settings.clone(), dynamic_enabled));
        Self::with_fetchers(settings, static_fetcher, dynamic_fetcher)
    }

    pub fn with_fetchers(
        settings: Arc<Settings>,
        static_fetcher: Arc<dyn StaticPageFetcher>,
        dynamic_fetcher: Box<dyn DynamicPageFetcher>,
    ) -> Self {
        Self {
            settings,
            static_fetcher,
            dynamic_fetcher,
        }
    }

    async fn scrape_product(
        &mut self,
        request: &CheckRequest,
    ) -> Result<CheckResponse, ScrapeFailure> {
        let static_result = match self.static_fetcher.fetch(&request.url).await {
            Ok(PageFetchOutcome::Html(html)) => html,
            Ok(PageFetchOutcome::Error(error)) => return Ok(error_result(error)),
            Err(FetchError::Timeout(detail)) => return Err(ScrapeFailure::Timeout(detail)),
            Err(FetchError::BrowserSession(detail)) | Err(FetchError::Unexpected(detail)) => {
                return Err(ScrapeFailure::BrowserSession(detail));
            }
        };

        let mut result = extract_from_html(
            &static_result,
            &request.url,
            request.css_selector.as_deref(),
            request.element_fingerprint.as_deref(),
            Some(SOURCE_STATIC),
            self.settings.max_content_length,
        );

        let should_try_dynamic = result.price.is_none()
            || result.stock_status.is_none()
            || result.stock_status.as_deref() == Some("out_of_stock");

        let mut dynamic_attempted = false;
        let mut dynamic_error = None;

        if should_try_dynamic {
            dynamic_attempted = true;
            let normalized_selector =
                normalize_css_selector(&request.url, request.css_selector.as_deref());
            match self
                .dynamic_fetcher
                .fetch(&request.url, normalized_selector.as_deref())
                .await
            {
                Ok(PageFetchOutcome::Html(html)) => {
                    let dynamic_result = extract_from_html(
                        &html,
                        &request.url,
                        request.css_selector.as_deref(),
                        request.element_fingerprint.as_deref(),
                        Some(SOURCE_DYNAMIC),
                        self.settings.max_content_length,
                    );
                    if result.price.is_none() && dynamic_result.price.is_some() {
                        result.price = dynamic_result.price;
                    }
                    if dynamic_result.stock_status.is_some() {
                        result.stock_status = dynamic_result.stock_status;
                    }
                    result.raw_content = join_raw_content(
                        result.raw_content.take(),
                        dynamic_result.raw_content,
                        self.settings.max_content_length,
                    );
                }
                Ok(PageFetchOutcome::Error(error)) => {
                    dynamic_error = Some(error.clone());
                    result.raw_content = join_raw_content(
                        result.raw_content.take(),
                        Some(format!("[{SOURCE_DYNAMIC}] error={error}")),
                        self.settings.max_content_length,
                    );
                }
                Err(FetchError::Timeout(detail)) => return Err(ScrapeFailure::Timeout(detail)),
                Err(FetchError::BrowserSession(detail)) | Err(FetchError::Unexpected(detail)) => {
                    return Err(ScrapeFailure::BrowserSession(detail));
                }
            }
        }

        if result.price.is_none() && result.stock_status.is_none() {
            result.error = Some(resolve_empty_scrape_error(dynamic_attempted, dynamic_error));
        }

        Ok(result)
    }
}

pub struct ProductScraperFactory {
    settings: Arc<Settings>,
}

impl ProductScraperFactory {
    pub fn new(settings: Arc<Settings>) -> Self {
        Self { settings }
    }
}

impl ScrapeWorkerFactory for ProductScraperFactory {
    fn create(&self, worker_index: usize) -> Box<dyn ScrapeWorker> {
        Box::new(ProductScraper::new(
            self.settings.clone(),
            worker_index < self.settings.browser_concurrency,
        ))
    }
}

#[async_trait]
impl ScrapeWorker for ProductScraper {
    async fn start(&mut self) -> Result<(), ScrapeFailure> {
        self.dynamic_fetcher.start().await.map_err(|err| match err {
            FetchError::Timeout(detail) => ScrapeFailure::Timeout(detail),
            FetchError::BrowserSession(detail) | FetchError::Unexpected(detail) => {
                ScrapeFailure::BrowserSession(detail)
            }
        })
    }

    async fn shutdown(&mut self) {
        self.dynamic_fetcher.shutdown().await;
    }

    fn browser_health(&self) -> BrowserHealth {
        self.dynamic_fetcher.health()
    }

    async fn recycle_browser(&mut self, reason: &str) {
        self.dynamic_fetcher.recycle(reason).await;
    }

    async fn scrape(&mut self, request: &CheckRequest) -> Result<CheckResponse, ScrapeFailure> {
        self.scrape_product(request).await
    }
}

pub fn extract_from_html(
    html: &str,
    url: &str,
    css_selector: Option<&str>,
    element_fingerprint: Option<&str>,
    source_label: Option<&str>,
    max_content_length: usize,
) -> CheckResponse {
    let document = Html::parse_document(html);
    let mut price = None;
    let mut stock_status = None;
    let mut stock_priority = -1;
    let mut raw_parts = source_label
        .map(|source| vec![format!("[source] {source}")])
        .unwrap_or_default();

    let hostname = Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .unwrap_or_default();

    let mut strategies = Vec::new();
    if let Some(selector) = css_selector {
        strategies.push((
            "css_selector".to_string(),
            extract_css_selector(&document, selector),
        ));
    }
    if let Some(fingerprint) = element_fingerprint {
        strategies.push((
            "fingerprint".to_string(),
            extract_fingerprint(&document, fingerprint),
        ));
    }
    strategies.push((
        format!("host:{hostname}"),
        extract_host_specific(url, &document),
    ));
    strategies.push(("json-ld".to_string(), extract_json_ld(&document)));
    strategies.push(("title-window".to_string(), extract_title_window(&document)));
    strategies.push(("selectors".to_string(), extract_common_selectors(&document)));
    strategies.push(("meta".to_string(), extract_meta_price(&document)));

    for (label, extracted) in strategies {
        let Some(ExtractionResult {
            price: candidate_price,
            stock_status: candidate_stock_status,
            raw,
        }) = extracted
        else {
            continue;
        };

        if candidate_price.is_some() && price.is_none() {
            price = candidate_price;
        }
        if let Some(candidate_stock_status) = candidate_stock_status {
            let priority_key = label.split(':').next().unwrap_or(label.as_str());
            let candidate_priority = stock_source_priority(priority_key);
            if candidate_priority > stock_priority {
                stock_priority = candidate_priority;
                stock_status = Some(candidate_stock_status);
            }
        }
        if let Some(raw) = raw {
            raw_parts.push(format!("[{label}] {raw}"));
        }
    }

    CheckResponse {
        price: validate_price(price),
        stock_status,
        raw_content: if raw_parts.is_empty() {
            None
        } else {
            Some(
                raw_parts
                    .join("\n")
                    .chars()
                    .take(max_content_length)
                    .collect(),
            )
        },
        error: None,
    }
}

pub fn join_raw_content(
    existing: Option<String>,
    extra: Option<String>,
    max_content_length: usize,
) -> Option<String> {
    let parts = [existing, extra].into_iter().flatten().collect::<Vec<_>>();
    if parts.is_empty() {
        return None;
    }

    Some(parts.join("\n").chars().take(max_content_length).collect())
}

pub fn get_wait_selectors(
    url: &str,
    css_selector: Option<&str>,
    default_wait_selector: &str,
) -> Vec<String> {
    let mut selectors = Vec::new();
    if let Some(selector) = css_selector {
        selectors.push(selector.to_string());
    }

    let hostname = Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_lowercase))
        .unwrap_or_default();

    if hostname.contains("target.") {
        selectors.push("h1".to_string());
    } else if hostname.contains("amazon.") {
        selectors.push("#ppd".to_string());
    } else if hostname.contains("walmart.") {
        selectors.push("[data-testid='price-wrap']".to_string());
    } else if hostname.contains("bestbuy.") {
        selectors.push(".priceView-hero-price".to_string());
    } else if hostname.contains("costco.") {
        selectors.push("#pull-right-price".to_string());
    } else if hostname == "store.steampowered.com" {
        selectors.push("[class*='SaleSection_'], .game_area_purchase_game".to_string());
    } else if hostname.contains("tcgplayer.com") {
        selectors.push("button[id^='btnAddToCart'], .price-points, .product-details".to_string());
    }

    selectors.push(default_wait_selector.to_string());
    let mut deduped = Vec::new();
    for selector in selectors {
        if !deduped.contains(&selector) {
            deduped.push(selector);
        }
    }
    deduped
}

pub fn normalize_css_selector(url: &str, css_selector: Option<&str>) -> Option<String> {
    let selector = css_selector?;
    let hostname = Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_lowercase))
        .unwrap_or_default();

    if hostname.contains("tcgplayer.com") && selector.contains("btnAddToCart") {
        return Some("button[id^='btnAddToCart']".to_string());
    }

    Some(selector.to_string())
}

fn error_result(error: String) -> CheckResponse {
    CheckResponse {
        price: None,
        stock_status: None,
        raw_content: None,
        error: Some(error),
    }
}

fn resolve_empty_scrape_error(dynamic_attempted: bool, dynamic_error: Option<String>) -> String {
    match (dynamic_attempted, dynamic_error) {
        (true, Some(detail)) => format!("Dynamic fetch failed after empty extraction: {detail}"),
        _ => "No product data extracted from page".to_string(),
    }
}

fn stock_source_priority(label: &str) -> i32 {
    match label {
        "css_selector" => 100,
        "fingerprint" => 95,
        "host" => 90,
        "json-ld" => 80,
        "selectors" => 70,
        "title-window" => 50,
        "meta" => 10,
        _ => 0,
    }
}
