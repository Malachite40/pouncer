use once_cell::sync::Lazy;
use regex::Regex;
use scraper::ElementRef;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ExtractionResult {
    pub price: Option<f64>,
    pub stock_status: Option<String>,
    pub raw: Option<String>,
}

static NON_DIGIT_PRICE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[^\d.,]").expect("valid non-digit price regex"));
static SALE_PRICE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)(?:now|sale\s*price|current\s*price|your\s*price)\s*:?\s*([$£€]?\s*\d[\d.,]*)")
        .expect("valid sale price regex")
});
static PRICE_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        Regex::new(r"[$£€]\s*(\d[\d.,]*)").expect("valid currency prefix regex"),
        Regex::new(r"(\d[\d.,]*)\s*[$£€]").expect("valid currency suffix regex"),
        Regex::new(r"(\d[\d.,]*)\s*(?:EUR|USD|GBP)").expect("valid currency code regex"),
    ]
});
static WHITESPACE_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\s+").expect("valid whitespace regex"));

const PURCHASE_CTA_PATTERNS: &[&str] = &[
    "add to cart",
    "add to bag",
    "add to basket",
    "buy now",
    "buy it now",
];

pub fn parse_price_match(raw: &str) -> Option<f64> {
    let mut value = raw.trim().to_string();
    if value.is_empty() {
        return None;
    }

    value = NON_DIGIT_PRICE_RE.replace_all(&value, "").to_string();
    if value.is_empty() {
        return None;
    }

    if Regex::new(r"^\d{1,3}(\.\d{3})+(,\d{1,2})?$")
        .expect("valid european format regex")
        .is_match(&value)
    {
        value = value.replace('.', "").replace(',', ".");
    } else if Regex::new(r"^\d{1,3}(,\d{3})+(\.\d{1,2})?$")
        .expect("valid us thousands regex")
        .is_match(&value)
    {
        value = value.replace(',', "");
    } else if value.contains(',') && !value.contains('.') {
        let parts: Vec<&str> = value.split(',').collect();
        if parts.len() == 2 && parts[1].len() <= 2 {
            value = value.replace(',', ".");
        } else {
            value = value.replace(',', "");
        }
    }

    value.parse::<f64>().ok().filter(|parsed| *parsed > 0.0)
}

pub fn extract_price_from_text(text: &str) -> Option<f64> {
    if let Some(captures) = SALE_PRICE_RE.captures(text) {
        if let Some(price) = captures
            .get(1)
            .and_then(|value| parse_price_match(value.as_str()))
        {
            return Some(price);
        }
    }

    let mut prices = Vec::new();
    for pattern in PRICE_PATTERNS.iter() {
        for captures in pattern.captures_iter(text) {
            if let Some(price) = captures
                .get(1)
                .and_then(|value| parse_price_match(value.as_str()))
            {
                prices.push(price);
            }
        }
    }

    prices.into_iter().reduce(f64::min)
}

pub fn extract_stock_from_text(text: &str) -> Option<String> {
    let normalized = normalize_text(text);
    if normalized.is_empty() {
        return None;
    }

    const OUT_OF_STOCK_PATTERNS: &[&str] = &[
        "out of stock",
        "sold out",
        "currently unavailable",
        "temporarily unavailable",
        "this item is unavailable",
        "this product is unavailable",
        "not currently available",
        "no longer available",
        "discontinued",
    ];
    const IN_STOCK_PATTERNS: &[&str] = &[
        "in stock",
        "available for pickup",
        "available for shipping",
        "ready for pickup",
        "ship it",
        "add to cart",
        "add to bag",
        "add to basket",
        "buy now",
        "buy it now",
    ];
    const SOFT_OUT_OF_STOCK_PATTERNS: &[&str] = &[
        "notify me",
        "notify when available",
        "join waitlist",
        "waitlist",
        "backorder",
        "coming soon",
        "pre-order",
        "preorder",
        "email me when available",
    ];

    if OUT_OF_STOCK_PATTERNS
        .iter()
        .any(|pattern| normalized.contains(pattern))
    {
        return Some("out_of_stock".to_string());
    }

    if IN_STOCK_PATTERNS
        .iter()
        .any(|pattern| normalized.contains(pattern))
    {
        return Some("in_stock".to_string());
    }

    if SOFT_OUT_OF_STOCK_PATTERNS
        .iter()
        .any(|pattern| normalized.contains(pattern))
    {
        return Some("out_of_stock".to_string());
    }

    None
}

pub fn is_purchase_cta_text(text: &str) -> bool {
    let normalized = normalize_text(text);
    !normalized.is_empty()
        && PURCHASE_CTA_PATTERNS
            .iter()
            .any(|pattern| normalized.contains(pattern))
}

pub fn validate_price(price: Option<f64>) -> Option<f64> {
    match price {
        Some(value) if value > 0.0 && value <= 100_000.0 => Some(value),
        _ => None,
    }
}

pub fn normalize_text(value: &str) -> String {
    WHITESPACE_RE.replace_all(value.trim(), " ").to_lowercase()
}

pub fn text_of_element(element: &ElementRef<'_>) -> String {
    let text = element.text().collect::<Vec<_>>().join(" ");
    WHITESPACE_RE.replace_all(text.trim(), " ").to_string()
}

pub fn is_element_disabled(element: &ElementRef<'_>) -> bool {
    if element.value().attr("disabled").is_some() {
        return true;
    }

    if element
        .value()
        .attr("aria-disabled")
        .is_some_and(|value| value.eq_ignore_ascii_case("true"))
    {
        return true;
    }

    element
        .value()
        .attr("class")
        .is_some_and(|classes| classes.to_lowercase().contains("disabled"))
}
