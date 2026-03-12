use scraper::{ElementRef, Html, Selector};

pub fn select_all<'a>(document: &'a Html, selector: &str) -> Vec<ElementRef<'a>> {
    Selector::parse(selector)
        .map(|selector| document.select(&selector).collect())
        .unwrap_or_default()
}

pub fn select_first<'a>(document: &'a Html, selector: &str) -> Option<ElementRef<'a>> {
    Selector::parse(selector)
        .ok()
        .and_then(|selector| document.select(&selector).next())
}

pub fn select_from_element<'a>(element: &ElementRef<'a>, selector: &str) -> Vec<ElementRef<'a>> {
    Selector::parse(selector)
        .map(|selector| element.select(&selector).collect())
        .unwrap_or_default()
}

pub fn all_elements_by_tag<'a>(document: &'a Html, tag_name: &str) -> Vec<ElementRef<'a>> {
    Selector::parse(tag_name)
        .map(|selector| document.select(&selector).collect())
        .unwrap_or_default()
}
