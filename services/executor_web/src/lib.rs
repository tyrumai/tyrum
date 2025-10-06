//! Playwright-backed generic web executor scaffolding.
//!
//! The executor spins up a headless Chromium instance via Playwright to
//! automate web flows described by planner `ActionPrimitive`s. The
//! implementation focuses on the initial capability: launching a browser,
//! navigating to a URL, and returning a lightweight page snapshot. Further
//! primitives (form interactions, postcondition enforcement) will extend this
//! surface in follow-up issues per the product concept (§15-16).

use std::{collections::HashSet, sync::Arc};

use playwright::{
    Playwright,
    api::{browser::Browser, page::Page},
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tyrum_shared::planner::{ActionPrimitive, ActionPrimitiveKind};
use url::Url;

/// Result alias for executor operations.
pub type Result<T> = std::result::Result<T, WebExecutorError>;

/// Captures the observable state after a web action finishes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebActionOutcome {
    /// Final URL reported by the page after navigation completes.
    pub current_url: String,
    /// Page title extracted via the DOM.
    pub title: String,
    /// Sanitised DOM excerpt returned to the planner for postcondition checks.
    pub dom_excerpt: DomExcerpt,
    /// Summary of submitted inputs with sensitive values optionally redacted.
    pub submitted_fields: Vec<SubmittedFieldSummary>,
    /// Browser family used to satisfy the action.
    pub browser: BrowserFlavor,
}

/// Represents a focussed snapshot of the DOM relevant to the executed action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomExcerpt {
    /// CSS selector used to capture the excerpt.
    pub selector: String,
    /// HTML markup of the excerpt with sensitive inputs redacted.
    pub html: String,
}

/// Captures the inputs the executor attempted to submit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubmittedFieldSummary {
    /// CSS selector applied to identify the field.
    pub selector: String,
    /// Serialized value sent to the page. Sensitive fields are replaced with `REDACTED`.
    pub value: String,
    /// Indicates whether the value was redacted in logs and snapshots.
    pub redacted: bool,
}

/// Execution guardrail describing the sandbox that Playwright enforces.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WebSandboxConstraints {
    /// Indicates the browser runs in headless mode without OS-level UI access.
    pub headless: bool,
    /// Signals that the process drops root privileges inside the container.
    pub runs_as_non_root: bool,
}

impl Default for WebSandboxConstraints {
    fn default() -> Self {
        Self {
            headless: true,
            runs_as_non_root: true,
        }
    }
}

/// Errors surfaced by the web executor.
#[derive(Debug, Error)]
pub enum WebExecutorError {
    /// Planner requested a primitive the executor cannot handle.
    #[error("unsupported primitive kind {0:?}")]
    UnsupportedPrimitive(ActionPrimitiveKind),
    /// Planner did not include the mandatory `url` argument.
    #[error("missing required argument '{0}'")]
    MissingArgument(&'static str),
    /// Provided URL failed validation.
    #[error("invalid url '{value}': {source}")]
    InvalidUrl {
        /// Parser error from the `url` crate.
        #[source]
        source: url::ParseError,
        /// Original string that failed to parse.
        value: String,
    },
    /// Planner provided malformed structured arguments.
    #[error("invalid argument '{argument}': {source}")]
    InvalidArgument {
        /// Name of the argument that failed to deserialize.
        argument: &'static str,
        /// Serde error surfaced during decoding.
        #[source]
        source: serde_json::Error,
    },
    /// Structured argument passed validation but contains unusable data.
    #[error("invalid argument '{argument}': {reason}")]
    InvalidArgumentValue {
        /// Name of the argument with an invalid value.
        argument: &'static str,
        /// Human-readable explanation.
        reason: &'static str,
    },
    /// Error reported by Playwright initialization.
    #[error("playwright initialization failed: {0}")]
    Playwright(#[from] playwright::Error),
    /// Error reported by the Playwright driver (async operations).
    #[error("playwright driver error: {0}")]
    PlaywrightDriver(#[from] Arc<playwright::Error>),
    /// None of the supported browser engines could be launched.
    #[error("unable to launch supported browser: {details}")]
    BrowserUnavailable { details: String },
}

/// Enumerates the browser engines supported by the executor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BrowserFlavor {
    /// Chromium-family browsers (Chrome, Edge).
    Chromium,
    /// WebKit (Safari) engine.
    Webkit,
}

/// Launches Playwright, opens the requested URL, and captures a page snapshot.
///
/// The function validates that the supplied primitive targets the generic web
/// executor (`ActionPrimitiveKind::Web`) and expects a `url` argument inside
/// `ActionPrimitive::args`. Callers receive the resulting URL, page title, and
/// HTML snapshot to evaluate postconditions downstream.
///
/// # Errors
/// * [`WebExecutorError::UnsupportedPrimitive`] when invoked with a non-web
///   primitive.
/// * [`WebExecutorError::MissingArgument`] or
///   [`WebExecutorError::InvalidUrl`] if the planner payload omits or
///   misconfigures the `url` argument.
/// * [`WebExecutorError::Playwright`] or [`WebExecutorError::PlaywrightDriver`]
///   for failures during browser provisioning or navigation.
pub async fn execute_web_action(action: &ActionPrimitive) -> Result<WebActionOutcome> {
    ensure_web_primitive(action)?;
    let target = extract_url(action)?;
    let options = parse_web_action_options(action)?;

    let playwright = Playwright::initialize().await?;
    let (browser, browser_flavor) = launch_browser(&playwright).await?;
    let context = browser.context_builder().build().await?;
    let page = context.new_page().await?;

    page.goto_builder(target.as_str()).goto().await?;

    let auto_redacted = identify_sensitive_fields(&page, &options.fields).await?;

    fill_fields(&page, &options.fields).await?;
    submit_form(&page, &options.submit).await?;

    if let Some(wait_ms) = options.submit.wait_after_ms {
        page.wait_for_timeout(wait_ms as f64).await;
    }

    let title = page.title().await?;
    let current_url: String = page.eval("() => window.location.href").await?;
    let dom_excerpt = capture_dom_excerpt(&page, &options).await?;
    let submitted_fields = summarize_fields(&options.fields, &auto_redacted);

    // Close context and browser to keep future test runs predictable. Ignore
    // errors during teardown since the main navigation already succeeded.
    let _ = page.close(None).await;
    let _ = context.close().await;
    let _ = browser.close().await;

    Ok(WebActionOutcome {
        current_url,
        title,
        dom_excerpt,
        submitted_fields,
        browser: browser_flavor,
    })
}

/// Returns static sandbox properties enforced by the container runtime.
pub fn sandbox_constraints() -> WebSandboxConstraints {
    WebSandboxConstraints::default()
}

fn ensure_web_primitive(action: &ActionPrimitive) -> Result<()> {
    if action.kind != ActionPrimitiveKind::Web {
        return Err(WebExecutorError::UnsupportedPrimitive(action.kind));
    }
    Ok(())
}

fn extract_url(action: &ActionPrimitive) -> Result<Url> {
    let value = action
        .args
        .get("url")
        .ok_or(WebExecutorError::MissingArgument("url"))?;
    let url_str = value
        .as_str()
        .ok_or(WebExecutorError::MissingArgument("url"))?;
    Url::parse(url_str).map_err(|source| WebExecutorError::InvalidUrl {
        source,
        value: url_str.to_string(),
    })
}

async fn launch_browser(playwright: &Playwright) -> Result<(Browser, BrowserFlavor)> {
    let mut notes = Vec::new();

    // Attempt Chromium first for parity with other runtimes; fall back to
    // WebKit on platforms where Chromium binaries are unavailable (e.g.,
    // macOS 15 at the time of writing).
    if let Err(err) = playwright.install_chromium() {
        notes.push(format!("chromium install: {err}"));
    }

    match playwright
        .chromium()
        .launcher()
        .headless(true)
        .launch()
        .await
    {
        Ok(browser) => return Ok((browser, BrowserFlavor::Chromium)),
        Err(err) => {
            notes.push(format!("chromium launch: {err}"));
        }
    }

    if let Err(err) = playwright.install_webkit() {
        notes.push(format!("webkit install: {err}"));
    }

    match playwright.webkit().launcher().headless(true).launch().await {
        Ok(browser) => Ok((browser, BrowserFlavor::Webkit)),
        Err(err) => {
            notes.push(format!("webkit launch: {err}"));
            Err(WebExecutorError::BrowserUnavailable {
                details: notes.join("; "),
            })
        }
    }
}

const REDACTED_VALUE: &str = "REDACTED";

#[derive(Debug)]
struct WebActionOptions {
    fields: Vec<FormFieldSpec>,
    submit: SubmitActionSpec,
    snapshot_selector: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct FormFieldSpec {
    selector: String,
    value: String,
    #[serde(default)]
    redact: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct SubmitActionSpec {
    selector: String,
    #[serde(default)]
    kind: SubmitActionKind,
    #[serde(default)]
    wait_after_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum SubmitActionKind {
    Click,
    Submit,
}

impl Default for SubmitActionKind {
    fn default() -> Self {
        Self::Click
    }
}

fn parse_web_action_options(action: &ActionPrimitive) -> Result<WebActionOptions> {
    let fields = action
        .args
        .get("fields")
        .map(|value| {
            serde_json::from_value::<Vec<FormFieldSpec>>(value.clone()).map_err(|source| {
                WebExecutorError::InvalidArgument {
                    argument: "fields",
                    source,
                }
            })
        })
        .transpose()? // Option<Result<..>> -> Result<Option<..>>
        .unwrap_or_default();

    let submit_value = action
        .args
        .get("submit")
        .ok_or(WebExecutorError::MissingArgument("submit"))?;
    let submit: SubmitActionSpec =
        serde_json::from_value(submit_value.clone()).map_err(|source| {
            WebExecutorError::InvalidArgument {
                argument: "submit",
                source,
            }
        })?;

    if submit.selector.trim().is_empty() {
        return Err(WebExecutorError::InvalidArgumentValue {
            argument: "submit.selector",
            reason: "selector must not be empty",
        });
    }

    let snapshot_selector = if let Some(value) = action.args.get("snapshot_selector") {
        Some(parse_selector_argument(value, "snapshot_selector")?)
    } else if let Some(value) = action.args.get("result_selector") {
        Some(parse_selector_argument(value, "result_selector")?)
    } else {
        None
    };

    Ok(WebActionOptions {
        fields,
        submit,
        snapshot_selector,
    })
}

async fn fill_fields(page: &Page, fields: &[FormFieldSpec]) -> Result<()> {
    for field in fields {
        page.fill_builder(&field.selector, &field.value)
            .fill()
            .await?;
    }
    Ok(())
}

fn parse_selector_argument(value: &serde_json::Value, argument: &'static str) -> Result<String> {
    serde_json::from_value::<String>(value.clone())
        .map_err(|source| WebExecutorError::InvalidArgument { argument, source })
}

async fn submit_form(page: &Page, submit: &SubmitActionSpec) -> Result<()> {
    match submit.kind {
        SubmitActionKind::Click => {
            page.click_builder(&submit.selector).click().await?;
        }
        SubmitActionKind::Submit => {
            page.evaluate_on_selector::<_, bool>(
                &submit.selector,
                "(element) => {
                        if (!element) {
                            throw new Error('submit selector not found');
                        }

                        if (element instanceof HTMLFormElement) {
                            element.requestSubmit();
                            return true;
                        }

                        const form = element.closest('form');
                        if (form) {
                            form.requestSubmit(element);
                            return true;
                        }

                        element.dispatchEvent(
                            new Event('submit', { bubbles: true, cancelable: true })
                        );
                        return true;
                    }",
                Option::<()>::None,
            )
            .await?;
        }
    }

    Ok(())
}

async fn capture_dom_excerpt(page: &Page, options: &WebActionOptions) -> Result<DomExcerpt> {
    let mut selector = options
        .snapshot_selector
        .as_deref()
        .unwrap_or("#confirmation");

    let mut html = snapshot_with_selector(page, selector, redact_selectors(options)).await?;

    if html.is_none() {
        selector = "body";
        html = snapshot_with_selector(page, selector, redact_selectors(options)).await?;
    }

    Ok(DomExcerpt {
        selector: selector.to_string(),
        html: html.unwrap_or_default(),
    })
}

fn redact_selectors(options: &WebActionOptions) -> Vec<String> {
    options
        .fields
        .iter()
        .filter(|field| field.redact)
        .map(|field| field.selector.clone())
        .collect()
}

async fn snapshot_with_selector(
    page: &Page,
    selector: &str,
    redacted_selectors: Vec<String>,
) -> Result<Option<String>> {
    #[derive(Serialize)]
    struct SnapshotArgs<'a> {
        selector: &'a str,
        redacted_selectors: &'a [String],
        mask_value: &'a str,
    }

    let args = SnapshotArgs {
        selector,
        redacted_selectors: &redacted_selectors,
        mask_value: REDACTED_VALUE,
    };

    let html: Option<String> = page
        .evaluate(
            "(config) => {
                const root = document.querySelector(config.selector);
                if (!root) {
                    return null;
                }

                const clone = root.cloneNode(true);
                const targets = clone.querySelectorAll('input, textarea');

                const shouldRedact = (element) => {
                    const type = (element.getAttribute('type') || '').toLowerCase();
                    if (type === 'submit' || type === 'button' || type === 'image' || type === 'reset') {
                        return false;
                    }

                    if (type === 'password') {
                        return true;
                    }

                    return (config.redacted_selectors || []).some((selector) => {
                        try {
                            return element.matches(selector);
                        } catch (_) {
                            return false;
                        }
                    });
                };

                for (const element of targets) {
                    if (!shouldRedact(element)) {
                        continue;
                    }

                    if (element instanceof HTMLInputElement) {
                        element.setAttribute('value', config.mask_value);
                    } else if (element instanceof HTMLTextAreaElement) {
                        element.textContent = config.mask_value;
                    }
                }

                return clone.outerHTML;
            }",
            args,
        )
        .await?;

    Ok(html)
}

fn summarize_fields(
    fields: &[FormFieldSpec],
    auto_redacted: &HashSet<String>,
) -> Vec<SubmittedFieldSummary> {
    fields
        .iter()
        .map(|field| SubmittedFieldSummary {
            selector: field.selector.clone(),
            value: if field.redact || auto_redacted.contains(&field.selector) {
                REDACTED_VALUE.to_string()
            } else {
                field.value.clone()
            },
            redacted: field.redact || auto_redacted.contains(&field.selector),
        })
        .collect()
}

async fn identify_sensitive_fields(
    page: &Page,
    fields: &[FormFieldSpec],
) -> Result<HashSet<String>> {
    if fields.is_empty() {
        return Ok(HashSet::new());
    }

    #[derive(Serialize)]
    struct Args<'a> {
        selectors: Vec<&'a str>,
    }

    let args = Args {
        selectors: fields.iter().map(|field| field.selector.as_str()).collect(),
    };

    let sensitive: Vec<String> = page
        .evaluate(
            "(config) => {
                const sensitive = [];
                for (const selector of config.selectors) {
                    let element;
                    try {
                        element = document.querySelector(selector);
                    } catch (_) {
                        element = null;
                    }

                    if (!element) {
                        continue;
                    }

                    const typeAttr = (element.getAttribute('type') || '').toLowerCase();
                    if (typeAttr === 'password') {
                        sensitive.push(selector);
                        continue;
                    }

                    const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase();
                    if (autocomplete === 'current-password' || autocomplete === 'new-password') {
                        sensitive.push(selector);
                    }
                }

                return sensitive;
            }",
            args,
        )
        .await?;

    Ok(sensitive.into_iter().collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tyrum_shared::planner::ActionArguments;

    #[tokio::test]
    async fn rejects_non_web_primitives() {
        let primitive =
            ActionPrimitive::new(ActionPrimitiveKind::Message, ActionArguments::default());
        let err = execute_web_action(&primitive)
            .await
            .expect_err("should fail");
        assert!(matches!(
            err,
            WebExecutorError::UnsupportedPrimitive(ActionPrimitiveKind::Message)
        ));
    }

    #[tokio::test]
    async fn errors_on_missing_url() {
        let primitive = ActionPrimitive::new(ActionPrimitiveKind::Web, ActionArguments::default());
        let err = execute_web_action(&primitive)
            .await
            .expect_err("missing url");
        assert!(matches!(err, WebExecutorError::MissingArgument("url")));
    }

    #[tokio::test]
    async fn errors_on_invalid_url() {
        let args = ActionArguments::from_iter([(String::from("url"), json!("not a url"))]);
        let primitive = ActionPrimitive::new(ActionPrimitiveKind::Web, args);
        let err = execute_web_action(&primitive).await.expect_err("bad url");
        assert!(matches!(err, WebExecutorError::InvalidUrl { value, .. } if value == "not a url"));
    }

    #[tokio::test]
    async fn errors_on_missing_submit_configuration() {
        let args =
            ActionArguments::from_iter([(String::from("url"), json!("https://example.test"))]);
        let primitive = ActionPrimitive::new(ActionPrimitiveKind::Web, args);
        let err = execute_web_action(&primitive)
            .await
            .expect_err("missing submit configuration");
        assert!(matches!(err, WebExecutorError::MissingArgument("submit")));
    }
}
