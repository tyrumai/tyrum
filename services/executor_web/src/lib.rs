//! Playwright-backed generic web executor scaffolding.
//!
//! The executor spins up a headless Chromium instance via Playwright to
//! automate web flows described by planner `ActionPrimitive`s. The
//! implementation focuses on the initial capability: launching a browser,
//! navigating to a URL, and returning a lightweight page snapshot. Further
//! primitives (form interactions, postcondition enforcement) will extend this
//! surface in follow-up issues per the product concept (§15-16).

use std::sync::Arc;

use playwright::{Playwright, api::browser::Browser};
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
    /// Raw HTML snapshot of the document body for auditing.
    pub html: String,
    /// Browser family used to satisfy the action.
    pub browser: BrowserFlavor,
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

    let playwright = Playwright::initialize().await?;
    let (browser, browser_flavor) = launch_browser(&playwright).await?;
    let context = browser.context_builder().build().await?;
    let page = context.new_page().await?;

    page.goto_builder(target.as_str()).goto().await?;

    let title = page.title().await?;
    let html = page.content().await?;
    let current_url: String = page.eval("() => window.location.href").await?;

    // Close context and browser to keep future test runs predictable. Ignore
    // errors during teardown since the main navigation already succeeded.
    let _ = page.close(None).await;
    let _ = context.close().await;
    let _ = browser.close().await;

    Ok(WebActionOutcome {
        current_url,
        title,
        html,
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
}
