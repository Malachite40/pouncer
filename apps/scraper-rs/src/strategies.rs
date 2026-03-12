use once_cell::sync::Lazy;
use regex::Regex;
use scraper::{ElementRef, Html};
use serde_json::Value;

use crate::{
    dom::{all_elements_by_tag, select_all, select_first, select_from_element},
    parsing::{
        ExtractionResult, extract_price_from_text, extract_stock_from_text, is_element_disabled,
        is_purchase_cta_text, normalize_text, parse_price_match, text_of_element,
    },
};

const INTERACTIVE_TAGS: &[&str] = &["button", "input", "a"];
const STABLE_ATTRS: &[&str] = &[
    "data-testid",
    "data-test-id",
    "data-qa",
    "data-cy",
    "data-product-id",
    "data-price",
    "data-sku",
    "itemprop",
    "role",
    "type",
    "name",
    "aria-label",
];
const ADD_TO_CART_TEXTS: &[&str] = &[
    "add to cart",
    "add to bag",
    "add to basket",
    "buy now",
    "buy it now",
];
const OOS_BUTTON_TEXTS: &[&str] = &["sold out", "notify me", "join waitlist", "coming soon"];
const META_PRICE_PROPERTIES: &[&str] = &[
    "product:price:amount",
    "og:price:amount",
    "product:price",
    "og:price",
    "price",
];

static NOISE_KEYWORDS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\b(shipping|delivery|handling|tax|estimated|free delivery)\b")
        .expect("valid noise keyword regex")
});
static OLD_PRICE_PREFIXES: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*(was|original|compare\s+at|reg\.?|msrp|list\s+price|regular\s+price)\s*:?\s*")
        .expect("valid old price regex")
});
static PRICE_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[$€£¥₹]\s*\d|^\d[\d,]*\.\d{2}$").expect("valid price pattern"));

pub fn extract_css_selector(document: &Html, css_selector: &str) -> Option<ExtractionResult> {
    let elements = select_all(document, css_selector);
    if elements.is_empty() {
        return None;
    }

    let text = elements
        .iter()
        .map(text_of_element)
        .collect::<Vec<_>>()
        .join(" ");
    let price = extract_price_from_text(&text);
    let mut stock_status = extract_stock_from_text(&text);

    if price.is_none() && stock_status.is_none() {
        return None;
    }

    if stock_status.as_deref() == Some("in_stock") {
        for element in &elements {
            let tag_name = element.value().name();
            let is_interactive = INTERACTIVE_TAGS.contains(&tag_name)
                || element
                    .value()
                    .attr("role")
                    .is_some_and(|value| value.eq_ignore_ascii_case("button"));
            let element_text = if tag_name == "input" {
                element
                    .value()
                    .attr("value")
                    .unwrap_or_default()
                    .to_string()
            } else {
                text_of_element(element)
            };
            if is_interactive && is_element_disabled(element) && is_purchase_cta_text(&element_text)
            {
                stock_status = Some("out_of_stock".to_string());
                break;
            }
        }
    }

    Some(ExtractionResult {
        price,
        stock_status,
        raw: Some(text),
    })
}

pub fn extract_title_window(document: &Html) -> Option<ExtractionResult> {
    let heading = find_primary_heading(document);
    let lines = document
        .root_element()
        .text()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if lines.is_empty() {
        return None;
    }

    let start_index = heading
        .as_deref()
        .map(normalize_text)
        .and_then(|normalized_heading| {
            lines.iter().position(|line| {
                let normalized_line = normalize_text(line);
                (!normalized_heading.is_empty())
                    && (normalized_line.contains(&normalized_heading)
                        || normalized_heading.contains(&normalized_line))
            })
        })
        .unwrap_or(0);

    let filtered = lines[start_index..usize::min(start_index + 10, lines.len())]
        .iter()
        .filter(|line| !NOISE_KEYWORDS.is_match(&line.to_lowercase()))
        .filter(|line| !OLD_PRICE_PREFIXES.is_match(line))
        .cloned()
        .collect::<Vec<_>>();

    if filtered.is_empty() {
        return None;
    }

    let window_text = filtered.join(" | ");
    let price = extract_price_from_text(&window_text);
    let stock_status = extract_stock_from_text(&window_text);

    if price.is_none() && stock_status.is_none() {
        return None;
    }

    Some(ExtractionResult {
        price,
        stock_status,
        raw: Some(window_text.chars().take(300).collect()),
    })
}

pub fn extract_common_selectors(document: &Html) -> Option<ExtractionResult> {
    let (price, price_raw) = extract_price_selectors(document);
    let (stock_status, stock_raw) = extract_stock_selectors(document);

    if price.is_none() && stock_status.is_none() {
        return None;
    }

    let raw_parts = [price_raw, stock_raw]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();

    Some(ExtractionResult {
        price,
        stock_status,
        raw: (!raw_parts.is_empty()).then(|| raw_parts.join(", ")),
    })
}

pub fn extract_price_selectors(document: &Html) -> (Option<f64>, Option<String>) {
    let selectors = [
        "[data-price]",
        r#"[itemprop="price"]"#,
        "#product .price",
        ".product-detail .price",
        "main .price",
        "[data-product-price]",
        ".product__price",
        ".price__current",
        ".price-current",
        ".product-price",
        ".price .money",
        ".price-box .price",
        ".product-info-price .price",
        "#priceblock_ourprice",
        "#priceblock_dealprice",
        ".a-price .a-offscreen",
        ".price",
    ];

    for selector in selectors {
        for element in select_all(document, selector) {
            if let Some(data_price) = element
                .value()
                .attr("data-price")
                .or_else(|| element.value().attr("data-product-price"))
            {
                if let Ok(value) = data_price.parse::<f64>() {
                    if value > 0.0 {
                        return (
                            Some(value),
                            Some(format!("{selector}: data-price={data_price}")),
                        );
                    }
                }
            }

            if let Some(content) = element.value().attr("content") {
                if let Ok(value) = content.parse::<f64>() {
                    if value > 0.0 {
                        return (Some(value), Some(format!("{selector}: content={content}")));
                    }
                }
            }

            let text = text_of_element(&element);
            if let Some(price) = extract_price_from_text(&text) {
                return (Some(price), Some(format!("{selector}: {text}")));
            }
        }
    }

    (None, None)
}

pub fn extract_stock_selectors(document: &Html) -> (Option<String>, Option<String>) {
    let selectors = [
        r#"[itemprop="availability"]"#,
        ".availability",
        ".stock-status",
        "#availability",
        ".product-availability",
    ];

    for selector in selectors {
        for element in select_all(document, selector) {
            let content = element
                .value()
                .attr("content")
                .or_else(|| element.value().attr("href"))
                .unwrap_or_default()
                .to_lowercase();
            let text = text_of_element(&element).to_lowercase();
            let combined = format!("{content} {text}");

            if content.contains("instock") {
                return (
                    Some("in_stock".to_string()),
                    Some(format!("{selector}: {content}")),
                );
            }
            if content.contains("outofstock") {
                return (
                    Some("out_of_stock".to_string()),
                    Some(format!("{selector}: {content}")),
                );
            }

            if let Some(stock_status) = extract_stock_from_text(&combined) {
                return (
                    Some(stock_status),
                    Some(format!(
                        "{selector}: {}",
                        if text.is_empty() { content } else { text }
                    )),
                );
            }
        }
    }

    let add_to_cart_selectors = [
        "button[name='add-to-cart']",
        "[data-testid='add-to-cart']",
        "#addToCart",
        "#add-to-cart",
        ".add-to-cart",
        "button.add-to-cart-button",
        "form[action*='/cart'] button[type='submit']",
    ];

    for selector in add_to_cart_selectors {
        if let Some(element) = select_first(document, selector) {
            if is_element_disabled(&element) {
                return (
                    Some("out_of_stock".to_string()),
                    Some(format!("{selector}: disabled")),
                );
            }
            return (
                Some("in_stock".to_string()),
                Some(format!("{selector}: enabled")),
            );
        }
    }

    extract_stock_from_buttons(document)
}

pub fn extract_fingerprint(document: &Html, fingerprint_json: &str) -> Option<ExtractionResult> {
    let Ok(value) = serde_json::from_str::<Value>(fingerprint_json) else {
        return None;
    };

    let tag_name = value
        .get("tagName")
        .and_then(Value::as_str)
        .map(str::to_lowercase)
        .unwrap_or_default();
    if tag_name.is_empty() {
        return None;
    }

    let stored_text = value
        .get("textContent")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let attributes = value.get("attributes").and_then(Value::as_object);
    let ancestor_tags = value
        .get("ancestorTags")
        .and_then(Value::as_array)
        .map(|tags| {
            tags.iter()
                .filter_map(Value::as_str)
                .map(str::to_lowercase)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let nearest_id = value.get("nearestIdAncestor").and_then(Value::as_str);
    let nearest_heading = value.get("nearestHeading").and_then(Value::as_str);

    if let Some(attributes) = attributes {
        for attr in STABLE_ATTRS {
            let Some(expected) = attributes.get(*attr).and_then(Value::as_str) else {
                continue;
            };

            let candidates = all_elements_by_tag(document, &tag_name)
                .into_iter()
                .filter(|element| {
                    element
                        .value()
                        .attr(attr)
                        .is_some_and(|value| value == expected)
                })
                .collect::<Vec<_>>();

            if candidates.len() == 1 {
                if let Some(result) = result_from_element(&candidates[0]) {
                    return Some(result);
                }
            } else {
                for candidate in candidates {
                    if text_overlaps(stored_text, &text_of_element(&candidate)) {
                        if let Some(result) = result_from_element(&candidate) {
                            return Some(result);
                        }
                    }
                }
            }
        }
    }

    if let Some(anchor_id) = nearest_id {
        if let Some(anchor) = select_first(document, &format!("#{anchor_id}")) {
            for element in select_from_element(&anchor, &tag_name) {
                if text_overlaps(stored_text, &text_of_element(&element)) {
                    if let Some(result) = result_from_element(&element) {
                        return Some(result);
                    }
                }
            }
        }
    }

    if let Some(heading) = nearest_heading {
        let normalized_heading = normalize_text(heading);
        for selector in ["h1", "h2", "h3", "h4", "h5", "h6"] {
            for candidate_heading in select_all(document, selector) {
                if normalize_text(&text_of_element(&candidate_heading))
                    .contains(&normalized_heading)
                {
                    for element in select_from_element(&candidate_heading, &tag_name) {
                        if text_overlaps(stored_text, &text_of_element(&element)) {
                            if let Some(result) = result_from_element(&element) {
                                return Some(result);
                            }
                        }
                    }

                    let mut parent = candidate_heading.parent();
                    while let Some(node) = parent {
                        if let Some(parent_element) = ElementRef::wrap(node) {
                            for element in select_from_element(&parent_element, &tag_name) {
                                if text_overlaps(stored_text, &text_of_element(&element)) {
                                    if let Some(result) = result_from_element(&element) {
                                        return Some(result);
                                    }
                                }
                            }
                            break;
                        }
                        parent = node.parent();
                    }
                }
            }
        }
    }

    let mut matches = all_elements_by_tag(document, &tag_name)
        .into_iter()
        .filter_map(|element| {
            text_overlaps(stored_text, &text_of_element(&element)).then(|| {
                let score = if ancestor_tags.is_empty() {
                    0
                } else {
                    ancestor_tags_score(&ancestor_tags, &element)
                };
                (score, element)
            })
        })
        .collect::<Vec<_>>();

    matches.sort_by(|left, right| right.0.cmp(&left.0));
    matches
        .into_iter()
        .find_map(|(_score, element)| result_from_element(&element))
}

pub fn extract_meta_price(document: &Html) -> Option<ExtractionResult> {
    for target_prop in META_PRICE_PROPERTIES {
        for meta in select_all(document, "meta") {
            let prop = meta
                .value()
                .attr("property")
                .or_else(|| meta.value().attr("name"))
                .unwrap_or_default()
                .to_lowercase();
            if prop != *target_prop {
                continue;
            }

            let Some(content) = meta.value().attr("content") else {
                continue;
            };
            if let Some(price) = parse_price_match(content) {
                return Some(ExtractionResult {
                    price: Some(price),
                    stock_status: None,
                    raw: Some(format!("meta[{prop}]={content}")),
                });
            }
        }
    }

    None
}

fn find_primary_heading(document: &Html) -> Option<String> {
    if let Some(h1) = select_first(document, "h1") {
        let text = text_of_element(&h1);
        if !text.is_empty() {
            return Some(text);
        }
    }

    if let Some(meta) = select_first(document, r#"meta[property="og:title"]"#) {
        if let Some(content) = meta.value().attr("content") {
            if !content.trim().is_empty() {
                return Some(content.trim().to_string());
            }
        }
    }

    select_first(document, "title").map(|title| text_of_element(&title))
}

fn extract_stock_from_buttons(document: &Html) -> (Option<String>, Option<String>) {
    let mut add_to_cart_element = None;
    let mut out_of_stock_element = None;

    for selector in ["button", "input", "a"] {
        for element in select_all(document, selector).into_iter().take(50) {
            let text = if element.value().name() == "input" {
                element
                    .value()
                    .attr("value")
                    .unwrap_or_default()
                    .to_string()
            } else {
                text_of_element(&element)
            };

            if text.is_empty() || text.len() > 80 {
                continue;
            }

            let normalized = text.to_lowercase();
            if ADD_TO_CART_TEXTS
                .iter()
                .any(|pattern| normalized.contains(pattern))
            {
                add_to_cart_element = Some(element);
                break;
            }
            if out_of_stock_element.is_none()
                && OOS_BUTTON_TEXTS
                    .iter()
                    .any(|pattern| normalized.contains(pattern))
            {
                out_of_stock_element = Some(element);
            }
        }

        if add_to_cart_element.is_some() {
            break;
        }
    }

    if let Some(element) = add_to_cart_element {
        if is_element_disabled(&element) {
            return (
                Some("out_of_stock".to_string()),
                Some("button text: disabled".to_string()),
            );
        }
        return (
            Some("in_stock".to_string()),
            Some("button text: enabled".to_string()),
        );
    }

    if out_of_stock_element.is_some() {
        return (
            Some("out_of_stock".to_string()),
            Some("button text: oos".to_string()),
        );
    }

    (None, None)
}

fn result_from_element(element: &ElementRef<'_>) -> Option<ExtractionResult> {
    let text = text_of_element(element);
    if text.is_empty() {
        return None;
    }

    let price = extract_price_from_text(&text);
    let stock_status = extract_stock_from_text(&text);
    if price.is_none() && stock_status.is_none() {
        return None;
    }

    Some(ExtractionResult {
        price,
        stock_status,
        raw: Some(text),
    })
}

fn text_overlaps(stored: &str, candidate: &str) -> bool {
    let stored = normalize_text(stored);
    let candidate = normalize_text(candidate);
    if stored.is_empty() || candidate.is_empty() {
        return false;
    }

    if PRICE_PATTERN.is_match(&stored) {
        return PRICE_PATTERN.is_match(&candidate);
    }

    stored.contains(&candidate) || candidate.contains(&stored)
}

fn ancestor_tags_score(stored: &[String], candidate: &ElementRef<'_>) -> usize {
    let mut ancestors = Vec::new();
    let mut parent = candidate.parent();
    while let Some(node) = parent {
        if let Some(element) = ElementRef::wrap(node) {
            let name = element.value().name();
            if name != "html" {
                ancestors.insert(0, name.to_string());
            }
            if ancestors.len() >= 10 {
                break;
            }
        }
        parent = node.parent();
    }

    stored
        .iter()
        .rev()
        .zip(ancestors.iter().rev())
        .take_while(|(stored, candidate)| stored == candidate)
        .count()
}
