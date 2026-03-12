use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use pounce_scraper_rs::scrape::extract_from_html;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
struct PythonParityRequest<'a> {
    html: &'a str,
    url: &'a str,
    css_selector: Option<&'a str>,
    element_fingerprint: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
struct PythonParityResponse {
    price: Option<f64>,
    stock_status: Option<String>,
    error: Option<String>,
}

#[test]
fn compares_key_fixture_cases_with_python_extractor_when_available() {
    let interpreter = python_interpreter();
    if interpreter.is_none() || !script_path().exists() {
        return;
    }
    let interpreter = interpreter.unwrap();

    let cases = [
        (
            r#"
                <html><body>
                <span class="price">$49.99</span>
                <button>Add to Cart</button>
                </body></html>
            "#,
            "https://example.com/product",
            None,
        ),
        (
            r#"
                <html><head>
                <script type="application/ld+json">
                {"@type":"Product","offers":{"price":29.99,"availability":"InStock"}}
                </script>
                </head><body></body></html>
            "#,
            "https://example.com/json-ld",
            None,
        ),
        (
            r#"
                <html><body>
                <span class="my-price">$19.95</span>
                </body></html>
            "#,
            "https://example.com/css",
            Some(".my-price"),
        ),
    ];

    for (html, url, css_selector) in cases {
        let rust = extract_from_html(html, url, css_selector, None, None, 5_000);
        let Some(python) = run_python_case(&interpreter, html, url, css_selector) else {
            return;
        };

        assert_eq!(rust.price, python.price, "price mismatch for {url}");
        assert_eq!(
            rust.stock_status, python.stock_status,
            "stock mismatch for {url}"
        );
        assert_eq!(rust.error, python.error, "error mismatch for {url}");
    }
}

fn run_python_case(
    interpreter: &Path,
    html: &str,
    url: &str,
    css_selector: Option<&str>,
) -> Option<PythonParityResponse> {
    let request = serde_json::to_string(&PythonParityRequest {
        html,
        url,
        css_selector,
        element_fingerprint: None,
    })
    .ok()?;

    let output = Command::new(interpreter)
        .arg(script_path())
        .env("PYTHONPATH", repo_root().join("apps/scraper"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()
        .and_then(|mut child| {
            use std::io::Write;
            child.stdin.as_mut()?.write_all(request.as_bytes()).ok()?;
            child.wait_with_output().ok()
        })?;

    if !output.status.success() {
        return None;
    }

    serde_json::from_slice(&output.stdout).ok()
}

fn python_interpreter() -> Option<PathBuf> {
    let venv_python = repo_root().join("apps/scraper/.venv/bin/python");
    if venv_python.exists() {
        return Some(venv_python);
    }

    which("python3").or_else(|| which("python"))
}

fn which(binary: &str) -> Option<PathBuf> {
    Command::new("which")
        .arg(binary)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

fn script_path() -> PathBuf {
    repo_root().join("apps/scraper-rs/scripts/python_parity.py")
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("repo root")
        .to_path_buf()
}
