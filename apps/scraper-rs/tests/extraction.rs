use std::sync::Arc;

use async_trait::async_trait;
use pounce_scraper_rs::{
    browser::{DynamicPageFetcher, FetchError, PageFetchOutcome, StaticPageFetcher},
    config::Settings,
    models::CheckRequest,
    parsing::{extract_price_from_text, extract_stock_from_text, validate_price},
    runner::{BrowserHealth, ScrapeWorker},
    scrape::{ProductScraper, extract_from_html, get_wait_selectors, normalize_css_selector},
    strategies::{extract_price_selectors, extract_stock_selectors, extract_title_window},
};
use scraper::Html;

struct StaticFixtureFetcher {
    html: String,
}

#[async_trait]
impl StaticPageFetcher for StaticFixtureFetcher {
    async fn fetch(&self, _url: &str) -> Result<PageFetchOutcome, FetchError> {
        Ok(PageFetchOutcome::Html(self.html.clone()))
    }
}

struct DynamicFixtureFetcher {
    outcome: PageFetchOutcome,
}

#[async_trait]
impl DynamicPageFetcher for DynamicFixtureFetcher {
    async fn start(&mut self) -> Result<(), FetchError> {
        Ok(())
    }

    async fn shutdown(&mut self) {}

    fn health(&self) -> BrowserHealth {
        BrowserHealth::default()
    }

    async fn recycle(&mut self, _reason: &str) {}

    async fn fetch(
        &mut self,
        _url: &str,
        _css_selector: Option<&str>,
    ) -> Result<PageFetchOutcome, FetchError> {
        Ok(self.outcome.clone())
    }
}

#[test]
fn extracts_json_ld_product() {
    let html = r#"
        <html><head>
        <title>Test Product</title>
        <script type="application/ld+json">
        {"@type": "Product", "offers": {"price": 29.99, "availability": "InStock"}}
        </script>
        </head><body></body></html>
    "#;

    let result = extract_from_html(html, "https://example.com/product", None, None, None, 5_000);
    assert_eq!(result.price, Some(29.99));
    assert_eq!(result.stock_status.as_deref(), Some("in_stock"));
    assert_eq!(result.error, None);
}

#[test]
fn css_selector_override_wins() {
    let html = r#"<html><body><span class="my-price">$49.99</span></body></html>"#;
    let result = extract_from_html(
        html,
        "https://example.com/product",
        Some(".my-price"),
        None,
        None,
        5_000,
    );
    assert_eq!(result.price, Some(49.99));
}

#[test]
fn meta_tag_fallback_extracts_price() {
    let html = r#"
        <html><head>
        <meta property="product:price:amount" content="19.99">
        </head><body></body></html>
    "#;
    let result = extract_from_html(html, "https://example.com/product", None, None, None, 5_000);
    assert_eq!(result.price, Some(19.99));
}

#[test]
fn stronger_stock_signal_overrides_title_window_guess() {
    let html = r#"
        <html><body>
        <h1>Test Product</h1>
        <p>Add to Cart</p>
        <div class="availability">Out of Stock</div>
        </body></html>
    "#;
    let result = extract_from_html(html, "https://example.com/product", None, None, None, 5_000);
    assert_eq!(result.stock_status.as_deref(), Some("out_of_stock"));
}

#[test]
fn parses_us_and_european_prices() {
    assert_eq!(extract_price_from_text("$1,299.99"), Some(1299.99));
    assert_eq!(extract_price_from_text("29,99 EUR"), Some(29.99));
    assert_eq!(
        extract_price_from_text("Was $39.99 Now $19.99"),
        Some(19.99)
    );
}

#[test]
fn detects_stock_from_text() {
    assert_eq!(
        extract_stock_from_text("Add to Cart"),
        Some("in_stock".to_string())
    );
    assert_eq!(
        extract_stock_from_text("Sold Out"),
        Some("out_of_stock".to_string())
    );
}

#[test]
fn validates_price_boundaries() {
    assert_eq!(validate_price(Some(29.99)), Some(29.99));
    assert_eq!(validate_price(Some(0.0)), None);
    assert_eq!(validate_price(Some(150_000.0)), None);
}

#[test]
fn title_window_filters_shipping_noise() {
    let document = Html::parse_document(
        r#"
            <html><body>
            <h1>My Product</h1>
            <p>$29.99</p>
            <p>Free shipping on orders over $50</p>
            </body></html>
        "#,
    );
    let result = extract_title_window(&document).expect("title window result");
    assert_eq!(result.price, Some(29.99));
}

#[test]
fn price_and_stock_selectors_work() {
    let price_document =
        Html::parse_document(r#"<html><body><div data-price="29.99">$29.99</div></body></html>"#);
    let (price, _raw) = extract_price_selectors(&price_document);
    assert_eq!(price, Some(29.99));

    let stock_document = Html::parse_document(
        r#"<html><body><link itemprop="availability" href="https://schema.org/InStock"></body></html>"#,
    );
    let (stock, _raw) = extract_stock_selectors(&stock_document);
    assert_eq!(stock.as_deref(), Some("in_stock"));
}

#[test]
fn wait_selector_profiles_and_normalization_match_expected_hosts() {
    assert_eq!(
        get_wait_selectors("https://store.steampowered.com/steamdeck", None, "body",),
        vec![
            "[class*='SaleSection_'], .game_area_purchase_game".to_string(),
            "body".to_string(),
        ]
    );
    assert_eq!(
        get_wait_selectors("https://www.tcgplayer.com/product/123", None, "body"),
        vec![
            "button[id^='btnAddToCart'], .price-points, .product-details".to_string(),
            "body".to_string(),
        ]
    );
    assert_eq!(
        normalize_css_selector(
            "https://www.tcgplayer.com/product/123",
            Some("#btnAddToCart_FS_8925728-ca75c918"),
        ),
        Some("button[id^='btnAddToCart']".to_string())
    );
}

#[tokio::test]
async fn dynamic_stock_overrides_conflicting_static_stock() {
    let settings = Arc::new(Settings::default());
    let mut scraper = ProductScraper::with_fetchers(
        settings,
        Arc::new(StaticFixtureFetcher {
            html: r#"
                <html><body>
                <span class="price">$54.99</span>
                <button disabled>Add to Cart</button>
                </body></html>
            "#
            .to_string(),
        }),
        Box::new(DynamicFixtureFetcher {
            outcome: PageFetchOutcome::Html(
                r#"
                    <html><body>
                    <span class="price">$54.99</span>
                    <button>Add to Cart</button>
                    </body></html>
                "#
                .to_string(),
            ),
        }),
    );

    let result = scraper
        .scrape(&CheckRequest {
            url: "https://example.com/product".to_string(),
            css_selector: None,
            element_fingerprint: None,
        })
        .await
        .expect("scrape result");

    assert_eq!(result.price, Some(54.99));
    assert_eq!(result.stock_status.as_deref(), Some("in_stock"));
    assert!(
        result
            .raw_content
            .as_deref()
            .is_some_and(|content: &str| content.contains("[source] scrapling-static"))
    );
    assert!(
        result
            .raw_content
            .as_deref()
            .is_some_and(|content: &str| content.contains("[source] scrapling-dynamic"))
    );
}
