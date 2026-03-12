use scraper::Html;
use serde_json::Value;

use crate::{
    dom::select_all,
    parsing::{ExtractionResult, parse_price_match, text_of_element},
};

pub fn extract_json_ld(document: &Html) -> Option<ExtractionResult> {
    for script in select_all(document, r#"script[type="application/ld+json"]"#) {
        let raw = text_of_element(&script);
        let Ok(value) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };

        let mut products = Vec::new();
        find_products(&value, &mut products);
        for product in products {
            if let Some(result) = extract_from_product_json_ld(product) {
                return Some(result);
            }
        }
    }

    None
}

fn find_products<'a>(value: &'a Value, products: &mut Vec<&'a Value>) {
    match value {
        Value::Array(items) => {
            for item in items {
                find_products(item, products);
            }
        }
        Value::Object(map) => {
            let types = match map.get("@type") {
                Some(Value::String(value)) => vec![value.as_str()],
                Some(Value::Array(values)) => values.iter().filter_map(Value::as_str).collect(),
                _ => Vec::new(),
            };
            if types.iter().any(|value| *value == "Product") {
                products.push(value);
            }

            if let Some(Value::Array(graph)) = map.get("@graph") {
                for item in graph {
                    find_products(item, products);
                }
            }

            for key in ["mainEntity", "mainEntityOfPage"] {
                if let Some(nested) = map.get(key) {
                    find_products(nested, products);
                }
            }
        }
        _ => {}
    }
}

fn extract_from_product_json_ld(product: &Value) -> Option<ExtractionResult> {
    let offers = product.get("offers")?;

    match offers {
        Value::Object(map) => {
            let offer_types = match map.get("@type") {
                Some(Value::String(value)) => vec![value.as_str()],
                Some(Value::Array(values)) => values.iter().filter_map(Value::as_str).collect(),
                _ => Vec::new(),
            };

            if offer_types.iter().any(|value| *value == "AggregateOffer") {
                return extract_aggregate_offer(offers);
            }

            pick_best_offer(&[offers])
        }
        Value::Array(values) => {
            let refs = values.iter().collect::<Vec<_>>();
            pick_best_offer(&refs)
        }
        _ => None,
    }
}

fn extract_aggregate_offer(aggregate_offer: &Value) -> Option<ExtractionResult> {
    let mut price = None;
    let mut stock_status = None;
    let mut raw_parts = Vec::new();

    for key in ["lowPrice", "price"] {
        if let Some(value) = aggregate_offer.get(key).and_then(parse_json_ld_price) {
            price = Some(value);
            raw_parts.push(format!("{key}={value}"));
            break;
        }
    }

    if let Some(availability) = aggregate_offer
        .get("availability")
        .and_then(parse_json_ld_availability)
    {
        raw_parts.push(format!("availability={availability}"));
        stock_status = Some(availability);
    }

    if price.is_some() || stock_status.is_some() {
        return Some(ExtractionResult {
            price,
            stock_status,
            raw: Some(raw_parts.join(", ")),
        });
    }

    aggregate_offer
        .get("offers")
        .and_then(Value::as_array)
        .map(|values| values.iter().collect::<Vec<_>>())
        .and_then(|offers| pick_best_offer(&offers))
}

fn pick_best_offer(offers: &[&Value]) -> Option<ExtractionResult> {
    let mut in_stock_prices = Vec::new();
    let mut all_prices = Vec::new();

    for offer in offers {
        let price = offer
            .get("price")
            .and_then(parse_json_ld_price)
            .or_else(|| offer.get("lowPrice").and_then(parse_json_ld_price));
        let availability = offer
            .get("availability")
            .and_then(parse_json_ld_availability);

        if let Some(price) = price {
            if availability.as_deref() == Some("in_stock") {
                in_stock_prices.push((price, availability.clone()));
            }
            all_prices.push((price, availability));
        }
    }

    let chosen = in_stock_prices
        .into_iter()
        .min_by(|left, right| left.0.total_cmp(&right.0))
        .or_else(|| {
            all_prices
                .into_iter()
                .min_by(|left, right| left.0.total_cmp(&right.0))
        });

    if let Some((price, stock_status)) = chosen {
        let mut raw_parts = vec![format!("price={price}")];
        if let Some(availability) = stock_status.clone() {
            raw_parts.push(format!("availability={availability}"));
        }
        return Some(ExtractionResult {
            price: Some(price),
            stock_status,
            raw: Some(raw_parts.join(", ")),
        });
    }

    offers.first().and_then(|offer| {
        offer
            .get("availability")
            .and_then(parse_json_ld_availability)
            .map(|availability| ExtractionResult {
                price: None,
                stock_status: Some(availability.clone()),
                raw: Some(format!("availability={availability}")),
            })
    })
}

fn parse_json_ld_price(value: &Value) -> Option<f64> {
    let raw = match value {
        Value::String(value) => value.as_str(),
        Value::Number(value) => {
            return value
                .as_f64()
                .and_then(|price| parse_price_match(&price.to_string()));
        }
        _ => return None,
    };

    parse_price_match(raw)
}

fn parse_json_ld_availability(value: &Value) -> Option<String> {
    let normalized = value.to_string().to_lowercase();
    if normalized.contains("instock")
        || normalized.contains("preorder")
        || normalized.contains("presale")
    {
        return Some("in_stock".to_string());
    }
    if normalized.contains("outofstock")
        || normalized.contains("discontinued")
        || normalized.contains("soldout")
    {
        return Some("out_of_stock".to_string());
    }
    None
}
