use regex::Regex;
use scraper::Html;
use serde_json::Value;
use url::Url;

use crate::{
    dom::{select_all, select_first},
    parsing::{
        ExtractionResult, extract_price_from_text, is_element_disabled, is_purchase_cta_text,
        parse_price_match, text_of_element,
    },
};

pub fn extract_host_specific(url: &str, document: &Html) -> Option<ExtractionResult> {
    let hostname = Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_lowercase))
        .unwrap_or_default();

    if hostname.contains("target.") {
        return extract_target_data(document);
    }
    if hostname.contains("amazon.") {
        return extract_amazon_data(document);
    }
    if hostname.contains("walmart.") {
        return extract_walmart_data(document);
    }
    if hostname.contains("bestbuy.") {
        return extract_bestbuy_data(document);
    }
    if hostname.contains("costco.") {
        return extract_costco_data(document);
    }

    None
}

fn price_from_selectors(document: &Html, selectors: &[&str]) -> (Option<f64>, Option<String>) {
    for selector in selectors {
        for element in select_all(document, selector) {
            if let Some(content) = element.value().attr("content") {
                if let Some(price) = parse_price_match(content) {
                    return (
                        Some(price),
                        Some(format!("price={price} ({selector} content)")),
                    );
                }
            }

            let text = text_of_element(&element);
            if let Some(price) = extract_price_from_text(&text) {
                return (Some(price), Some(format!("price={price} ({selector})")));
            }
        }
    }

    (None, None)
}

fn extract_target_data(document: &Html) -> Option<ExtractionResult> {
    let price_patterns = [
        Regex::new(r#""formatted_current_price"\s*:\s*"([^"]+)""#).expect("valid target regex"),
        Regex::new(r#""current_retail"\s*:\s*"?(?P<price>\d+(?:\.\d{1,2})?)"?"#)
            .expect("valid target regex"),
        Regex::new(r#""retail"\s*:\s*"?(?P<price>\d+(?:\.\d{1,2})?)"?"#)
            .expect("valid target regex"),
    ];
    let stock_patterns = [
        (
            Regex::new(r#""availability_status"\s*:\s*"OUT_OF_STOCK""#)
                .expect("valid target regex"),
            "out_of_stock",
            "availability_status=OUT_OF_STOCK",
        ),
        (
            Regex::new(r#""availability_status"\s*:\s*"IN_STOCK""#).expect("valid target regex"),
            "in_stock",
            "availability_status=IN_STOCK",
        ),
        (
            Regex::new(r#""is_out_of_stock"\s*:\s*true"#).expect("valid target regex"),
            "out_of_stock",
            "is_out_of_stock=true",
        ),
        (
            Regex::new(r#""is_out_of_stock"\s*:\s*false"#).expect("valid target regex"),
            "in_stock",
            "is_out_of_stock=false",
        ),
        (
            Regex::new(r#""available_to_promise_network"\s*:\s*"NOT_AVAILABLE""#)
                .expect("valid target regex"),
            "out_of_stock",
            "available_to_promise_network=NOT_AVAILABLE",
        ),
        (
            Regex::new(r#""available_to_promise_network"\s*:\s*"AVAILABLE""#)
                .expect("valid target regex"),
            "in_stock",
            "available_to_promise_network=AVAILABLE",
        ),
    ];

    let mut price = None;
    let mut stock_status = None;
    let mut raw_parts = Vec::new();

    for script in select_all(document, "script") {
        let content = text_of_element(&script);
        if content.is_empty()
            || ![
                "current_retail",
                "formatted_current_price",
                "availability_status",
                "available_to_promise_network",
                "is_out_of_stock",
            ]
            .iter()
            .any(|marker| content.contains(marker))
        {
            continue;
        }

        if price.is_none() {
            for pattern in &price_patterns {
                if let Some(captures) = pattern.captures(&content) {
                    let extracted = captures
                        .name("price")
                        .map(|value| value.as_str().to_string())
                        .or_else(|| captures.get(1).map(|value| value.as_str().to_string()))
                        .and_then(|value| {
                            extract_price_from_text(&value).or_else(|| parse_price_match(&value))
                        });
                    if let Some(extracted) = extracted {
                        price = Some(extracted);
                        raw_parts.push(format!("price={extracted}"));
                        break;
                    }
                }
            }
        }

        if stock_status.is_none() {
            for (pattern, mapped_value, raw_value) in &stock_patterns {
                if pattern.is_match(&content) {
                    stock_status = Some((*mapped_value).to_string());
                    raw_parts.push((*raw_value).to_string());
                    break;
                }
            }
        }

        if price.is_some() && stock_status.is_some() {
            break;
        }
    }

    if price.is_none() && stock_status.is_none() {
        return None;
    }

    Some(ExtractionResult {
        price,
        stock_status,
        raw: Some(raw_parts.join(", ")),
    })
}

fn extract_amazon_data(document: &Html) -> Option<ExtractionResult> {
    let price_selectors = [
        "#corePriceDisplay_desktop_feature_div .aok-offscreen",
        ".a-price .a-offscreen",
        "#priceblock_ourprice",
        "#priceblock_dealprice",
        r#"span.a-price[data-a-color="price"] .a-offscreen"#,
        "#price_inside_buybox",
        "#newBuyBoxPrice",
    ];
    let (price, price_raw) = price_from_selectors(document, &price_selectors);
    let mut raw_parts = price_raw.into_iter().collect::<Vec<_>>();

    let mut stock_status = None;
    if let Some(availability) = select_first(document, "#availability") {
        let text = text_of_element(&availability).to_lowercase();
        if text.contains("in stock") {
            stock_status = Some("in_stock".to_string());
            raw_parts.push("availability=in_stock".to_string());
        } else if text.contains("unavailable") || text.contains("out of stock") {
            stock_status = Some("out_of_stock".to_string());
            raw_parts.push("availability=out_of_stock".to_string());
        }
    }

    if stock_status.is_none() {
        if let Some(add_to_cart) = select_first(document, "#add-to-cart-button") {
            let text = add_to_cart
                .value()
                .attr("value")
                .map(str::to_string)
                .unwrap_or_else(|| text_of_element(&add_to_cart));
            if is_purchase_cta_text(&text) {
                if is_element_disabled(&add_to_cart) {
                    stock_status = Some("out_of_stock".to_string());
                    raw_parts.push("add-to-cart=disabled".to_string());
                } else {
                    stock_status = Some("in_stock".to_string());
                    raw_parts.push("add-to-cart=present".to_string());
                }
            }
        }
    }

    if price.is_none() && stock_status.is_none() {
        return None;
    }

    Some(ExtractionResult {
        price,
        stock_status,
        raw: Some(raw_parts.join(", ")),
    })
}

fn extract_walmart_data(document: &Html) -> Option<ExtractionResult> {
    let price_selectors = [
        r#"[data-testid="price-wrap"] [itemprop="price"]"#,
        r#"span[itemprop="price"]"#,
        r#"[data-testid="price-wrap"]"#,
    ];
    let (mut price, price_raw) = price_from_selectors(document, &price_selectors);
    let mut raw_parts = price_raw.into_iter().collect::<Vec<_>>();

    if price.is_none() {
        for script in select_all(document, r#"script[id="__NEXT_DATA__"]"#) {
            let raw = text_of_element(&script);
            let Ok(data) = serde_json::from_str::<Value>(&raw) else {
                continue;
            };

            if let Some(value) = data
                .pointer("/props/pageProps/initialData/data/product/priceInfo/currentPrice/price")
                .and_then(Value::as_f64)
            {
                price = Some(value);
                raw_parts.push(format!("price={value} (__NEXT_DATA__)"));
                break;
            }
        }
    }

    let mut stock_status = None;
    if let Some(fulfillment) = select_first(document, r#"[data-testid="fulfillment-badge"]"#) {
        let text = text_of_element(&fulfillment).to_lowercase();
        if text.contains("out of stock") || text.contains("unavailable") {
            stock_status = Some("out_of_stock".to_string());
            raw_parts.push("fulfillment=out_of_stock".to_string());
        } else {
            stock_status = Some("in_stock".to_string());
            raw_parts.push("fulfillment=in_stock".to_string());
        }
    }

    if price.is_none() && stock_status.is_none() {
        return None;
    }

    Some(ExtractionResult {
        price,
        stock_status,
        raw: Some(raw_parts.join(", ")),
    })
}

fn extract_bestbuy_data(document: &Html) -> Option<ExtractionResult> {
    let price_selectors = [
        ".priceView-hero-price .priceView-customer-price span:first-child",
        "[data-testid='customer-price'] span",
        ".priceView-hero-price span",
    ];
    let (price, price_raw) = price_from_selectors(document, &price_selectors);
    let mut raw_parts = price_raw.into_iter().collect::<Vec<_>>();

    let mut stock_status = None;
    if select_first(document, r#"[data-button-state="SOLD_OUT"]"#).is_some() {
        stock_status = Some("out_of_stock".to_string());
        raw_parts.push("button=SOLD_OUT".to_string());
    } else if let Some(add_to_cart) = select_first(document, ".fulfillment-add-to-cart-button") {
        let text = text_of_element(&add_to_cart);
        if is_purchase_cta_text(&text) {
            if is_element_disabled(&add_to_cart) {
                stock_status = Some("out_of_stock".to_string());
                raw_parts.push("add-to-cart=disabled".to_string());
            } else {
                stock_status = Some("in_stock".to_string());
                raw_parts.push("add-to-cart=present".to_string());
            }
        }
    }

    if price.is_none() && stock_status.is_none() {
        return None;
    }

    Some(ExtractionResult {
        price,
        stock_status,
        raw: Some(raw_parts.join(", ")),
    })
}

fn extract_costco_data(document: &Html) -> Option<ExtractionResult> {
    let price_selectors = [
        "#pull-right-price span.value",
        ".your-price .value",
        r#"[automation-id="productPrice"]"#,
    ];
    let (price, price_raw) = price_from_selectors(document, &price_selectors);
    let mut raw_parts = price_raw.into_iter().collect::<Vec<_>>();

    let mut stock_status = None;
    let page_text = document.root_element().text().collect::<Vec<_>>().join(" ");
    if page_text.to_lowercase().contains("out of stock") {
        stock_status = Some("out_of_stock".to_string());
        raw_parts.push("text=out_of_stock".to_string());
    } else if let Some(add_to_cart) = select_first(
        document,
        "#add-to-cart-btn, #addToCartButton, .add-to-cart-btn",
    ) {
        let text = text_of_element(&add_to_cart);
        if is_purchase_cta_text(&text) {
            if is_element_disabled(&add_to_cart) {
                stock_status = Some("out_of_stock".to_string());
                raw_parts.push("add-to-cart=disabled".to_string());
            } else {
                stock_status = Some("in_stock".to_string());
                raw_parts.push("add-to-cart=present".to_string());
            }
        }
    }

    if price.is_none() && stock_status.is_none() {
        return None;
    }

    Some(ExtractionResult {
        price,
        stock_status,
        raw: Some(raw_parts.join(", ")),
    })
}
