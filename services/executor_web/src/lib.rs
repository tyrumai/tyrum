//! Playwright-backed generic web executor scaffolding.
//!
//! The executor spins up a headless Chromium instance via Playwright to
//! automate web flows described by planner `ActionPrimitive`s. The
//! implementation focuses on the initial capability: launching a browser,
//! navigating to a URL, and returning a lightweight page snapshot. Further
//! primitives (form interactions, postcondition enforcement) will extend this
//! surface in follow-up issues per the product concept (§15-16).

use std::{
    collections::{HashSet, VecDeque},
    sync::Arc,
    time::Duration,
};

use crate::telemetry::AttemptContext;
use playwright::{
    Playwright,
    api::{browser::Browser, page::Page},
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{sync::Mutex, time::sleep};
use tyrum_shared::planner::{ActionPrimitive, ActionPrimitiveKind};
use tyrum_shared::{
    AssertionKind, DomContext as PostconditionDomContext, EvaluationContext, PostconditionError,
    PostconditionReport, evaluate_postcondition,
};
use url::Url;

mod semantic;
pub mod telemetry;

const MAX_ATTEMPTS: u32 = 3;
const INITIAL_BACKOFF_MS: u64 = 200;
const MAX_BACKOFF_MS: u64 = 2_000;
const BACKOFF_MULTIPLIER: u32 = 2;

/// Result alias for executor operations.
pub type Result<T> = std::result::Result<T, WebExecutorError>;

/// Captures the observable state after a web action finishes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    /// Structured postcondition report when assertions were evaluated.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub postcondition: Option<PostconditionReport>,
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
    /// Planner supplied an invalid postcondition payload.
    #[error("invalid postcondition: {message}")]
    InvalidPostcondition { message: String },
    /// Planner requested a postcondition type that is not supported.
    #[error("unsupported_postcondition: {type_name}")]
    UnsupportedPostcondition { type_name: String },
    /// Postcondition evaluation was missing required evidence.
    #[error("missing postcondition evidence for {kind:?}")]
    PostconditionMissingEvidence { kind: AssertionKind },
    /// Postcondition evaluation completed but an assertion failed.
    #[error("postcondition failed")]
    PostconditionFailed { report: PostconditionReport },
    /// Selector lookup failed but semantic suggestions are available.
    #[error("selector drift detected; retry scheduled: {details:?}")]
    SelectorFallback {
        /// Details about selectors that drifted during this attempt.
        details: Vec<SelectorRetryDetail>,
    },
    /// Selector candidates exhausted across all retries.
    #[error(
        "selector resolution exhausted after {attempts} attempts; tried selectors: {attempted:?}"
    )]
    SelectorsExhausted {
        /// Number of attempts that were performed.
        attempts: u32,
        /// Summary of selectors that were attempted.
        attempted: Vec<SelectorAttemptSummary>,
    },
    /// Test-only helper variant to simulate transient failures.
    #[cfg(test)]
    #[error("transient test failure: {0}")]
    TestTransient(&'static str),
}

/// Describes the role of a selector that required retry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelectorRole {
    /// Selector associated with a form field at the given index.
    Field { index: usize },
    /// Selector associated with the submission action.
    Submit,
}

/// Structured retry detail for telemetry and planner logging.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectorRetryDetail {
    /// Role of the selector (field or submit).
    pub role: SelectorRole,
    /// Selectors attempted during the failed attempt.
    pub attempted: Vec<String>,
    /// Additional selectors suggested for follow-up attempts.
    pub suggestions: Vec<String>,
}

/// Summarises selectors attempted across all retries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectorAttemptSummary {
    /// Role of the selector (field or submit).
    pub role: SelectorRole,
    /// Ordered list of selectors that were tried.
    pub tried: Vec<String>,
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
    let options = Arc::new(parse_web_action_options(action)?);
    let action_for_retry = action.clone();
    let telemetry_context = AttemptContext::from_url(&target);
    let telemetry_for_retry = telemetry_context.clone();
    let supervisor = Arc::new(Mutex::new(SemanticRetrySupervisor::new(&options)));
    let supervisor_for_retry = supervisor.clone();
    let target_for_retry = target.clone();
    let action_context = Arc::new(action_for_retry);

    let result = execute_with_retry(&telemetry_context, move |attempt| {
        let target = target_for_retry.clone();
        let options = options.clone();
        let action = action_context.clone();
        let supervisor = supervisor_for_retry.clone();
        let telemetry_context = telemetry_for_retry.clone();
        async move {
            let selectors = {
                let mut guard = supervisor.lock().await;
                guard.begin_attempt()?
            };

            let plan = selectors.into_plan(options.clone());
            match run_single_attempt(target.clone(), plan).await {
                Ok(mut outcome) => {
                    evaluate_postcondition_report(&action, &mut outcome)?;
                    Ok(outcome)
                }
                Err(WebExecutorError::SelectorFallback { details }) => {
                    let mut guard = supervisor.lock().await;
                    let new_candidates = guard.register_fallback(&details);
                    let exhausted = guard.is_exhausted();
                    let attempts = guard.attempts();
                    let history = guard.history();
                    drop(guard);

                    if exhausted {
                        return Err(WebExecutorError::SelectorsExhausted {
                            attempts,
                            attempted: history,
                        });
                    }

                    telemetry::record_retry_event(
                        &telemetry_context,
                        attempt,
                        new_candidates as u32,
                    );
                    Err(WebExecutorError::SelectorFallback { details })
                }
                Err(err) => Err(err),
            }
        }
    })
    .await;

    match result {
        Ok(outcome) => Ok(outcome),
        Err(WebExecutorError::SelectorFallback { .. }) => {
            let guard = supervisor.lock().await;
            Err(WebExecutorError::SelectorsExhausted {
                attempts: guard.attempts(),
                attempted: guard.history(),
            })
        }
        Err(err) => Err(err),
    }
}

#[allow(clippy::cognitive_complexity)]
async fn execute_with_retry<F, Fut, T>(context: &AttemptContext, mut operation: F) -> Result<T>
where
    F: FnMut(u32) -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let mut attempt = 1;
    let mut backoff = Duration::from_millis(INITIAL_BACKOFF_MS);

    loop {
        let future = operation(attempt);
        let (result, _) =
            crate::telemetry::record_attempt(context, attempt, MAX_ATTEMPTS, future).await;

        match result {
            Ok(value) => return Ok(value),
            Err(err) => {
                if attempt >= MAX_ATTEMPTS || !is_transient(&err) {
                    tracing::error!(
                        attempt,
                        max_attempts = MAX_ATTEMPTS,
                        error = %err,
                        "web executor attempt failed"
                    );
                    return Err(err);
                }

                tracing::warn!(
                    attempt,
                    backoff_ms = backoff.as_millis() as i64,
                    error = %err,
                    "transient failure during Playwright execution; retrying"
                );

                sleep(backoff).await;
                attempt += 1;
                backoff = next_backoff(backoff);
            }
        }
    }
}

fn next_backoff(current: Duration) -> Duration {
    let multiplied = current
        .as_millis()
        .saturating_mul(BACKOFF_MULTIPLIER as u128)
        .min(MAX_BACKOFF_MS as u128);
    Duration::from_millis(multiplied as u64)
}

fn is_transient(err: &WebExecutorError) -> bool {
    matches!(
        err,
        WebExecutorError::Playwright(_)
            | WebExecutorError::PlaywrightDriver(_)
            | WebExecutorError::SelectorFallback { .. }
    ) || {
        #[cfg(test)]
        {
            matches!(err, WebExecutorError::TestTransient(_))
        }
        #[cfg(not(test))]
        {
            false
        }
    }
}

#[allow(clippy::cognitive_complexity)]
async fn run_single_attempt(target: Url, plan: ResolvedActionPlan) -> Result<WebActionOutcome> {
    let playwright = match Playwright::initialize().await {
        Ok(driver) => driver,
        Err(err) => {
            tracing::warn!(error = %err, "playwright initialization failed");
            return Err(WebExecutorError::from(err));
        }
    };
    let (browser, browser_flavor) = launch_browser(&playwright).await?;
    let context = browser.context_builder().build().await?;
    let page = context.new_page().await?;

    page.goto_builder(target.as_str()).goto().await?;

    ensure_selectors_present(&page, &plan).await?;

    let auto_redacted = identify_sensitive_fields(&page, &plan.fields).await?;

    fill_fields(&page, &plan.fields).await?;
    if let Some(submit) = plan.submit.as_ref() {
        submit_form(&page, submit).await?;
        wait_for_post_submit(&page, submit).await?;
    }

    let title = page.title().await?;
    let current_url: String = page.eval("() => window.location.href").await?;
    let dom_excerpt =
        capture_dom_excerpt(&page, plan.snapshot_selector.as_deref(), &plan.fields).await?;
    let submitted_fields = summarize_fields(&plan.fields, &auto_redacted);

    let _ = page.close(None).await;
    let _ = context.close().await;
    let _ = browser.close().await;

    Ok(WebActionOutcome {
        current_url,
        title,
        dom_excerpt,
        submitted_fields,
        browser: browser_flavor,
        postcondition: None,
    })
}

fn evaluate_postcondition_report(
    action: &ActionPrimitive,
    outcome: &mut WebActionOutcome,
) -> Result<()> {
    let Some(spec) = action.postcondition.as_ref() else {
        return Ok(());
    };

    let selector = outcome.dom_excerpt.selector.as_str();
    let selector_opt = (!selector.is_empty()).then_some(selector);
    let dom_context = PostconditionDomContext {
        selector: selector_opt,
        html: outcome.dom_excerpt.html.as_str(),
    };

    let context = EvaluationContext {
        http: None,
        json: None,
        dom: Some(dom_context),
    };

    match evaluate_postcondition(spec, &context) {
        Ok(report) => {
            if report.passed {
                outcome.postcondition = Some(report);
                Ok(())
            } else {
                Err(WebExecutorError::PostconditionFailed { report })
            }
        }
        Err(PostconditionError::Invalid { message }) => {
            Err(WebExecutorError::InvalidPostcondition { message })
        }
        Err(PostconditionError::Unsupported { type_name }) => {
            Err(WebExecutorError::UnsupportedPostcondition { type_name })
        }
        Err(PostconditionError::MissingEvidence { kind }) => {
            Err(WebExecutorError::PostconditionMissingEvidence { kind })
        }
    }
}

/// Returns static sandbox properties enforced by the container runtime.
pub fn sandbox_constraints() -> WebSandboxConstraints {
    WebSandboxConstraints::default()
}

async fn ensure_selectors_present(page: &Page, plan: &ResolvedActionPlan) -> Result<()> {
    let mut details = Vec::new();

    for field in &plan.fields {
        match selector_exists(page, &field.selector).await? {
            SelectorPresence::Present => {}
            SelectorPresence::Missing => {
                let suggestions = semantic::suggest_field_selectors(
                    page,
                    &field.original_selector,
                    &field.selector,
                )
                .await?;
                details.push(SelectorRetryDetail {
                    role: SelectorRole::Field { index: field.index },
                    attempted: vec![field.selector.clone()],
                    suggestions,
                });
            }
        }
    }

    if let Some(submit) = plan.submit.as_ref() {
        match selector_exists(page, &submit.selector).await? {
            SelectorPresence::Present => {}
            SelectorPresence::Missing => {
                let suggestions = semantic::suggest_submit_selectors(
                    page,
                    &submit.original_selector,
                    &submit.selector,
                )
                .await?;
                details.push(SelectorRetryDetail {
                    role: SelectorRole::Submit,
                    attempted: vec![submit.selector.clone()],
                    suggestions,
                });
            }
        }
    }

    if details.is_empty() {
        Ok(())
    } else {
        Err(WebExecutorError::SelectorFallback { details })
    }
}

enum SelectorPresence {
    Present,
    Missing,
}

async fn selector_exists(page: &Page, selector: &str) -> Result<SelectorPresence> {
    match page.query_selector(selector).await {
        Ok(Some(_)) => Ok(SelectorPresence::Present),
        Ok(None) => Ok(SelectorPresence::Missing),
        Err(err) => {
            tracing::debug!(
                selector,
                error = %err,
                "selector query returned error; treating as missing"
            );
            Ok(SelectorPresence::Missing)
        }
    }
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

#[derive(Debug, Clone)]
struct WebActionOptions {
    fields: Vec<FormFieldSpec>,
    submit: Option<SubmitActionSpec>,
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

#[derive(Debug, Clone)]
struct ResolvedFieldSpec {
    index: usize,
    selector: String,
    original_selector: String,
    value: String,
    redact: bool,
}

#[derive(Debug, Clone)]
struct ResolvedSubmitSpec {
    selector: String,
    original_selector: String,
    kind: SubmitActionKind,
    wait_after_ms: Option<u64>,
}

#[derive(Debug, Clone)]
struct ResolvedActionPlan {
    fields: Vec<ResolvedFieldSpec>,
    submit: Option<ResolvedSubmitSpec>,
    snapshot_selector: Option<String>,
}

#[derive(Debug)]
struct SemanticRetrySupervisor {
    fields: Vec<SelectorState>,
    submit: Option<SelectorState>,
    attempts: u32,
}

#[derive(Debug)]
struct SelectorState {
    queue: VecDeque<String>,
    attempted: Vec<String>,
}

#[derive(Debug, Clone)]
struct AttemptSelectors {
    field_selectors: Vec<String>,
    submit_selector: Option<String>,
}

impl AttemptSelectors {
    fn into_plan(self, options: Arc<WebActionOptions>) -> ResolvedActionPlan {
        let fields = options
            .fields
            .iter()
            .enumerate()
            .zip(self.field_selectors)
            .map(|((index, spec), selector)| ResolvedFieldSpec {
                index,
                original_selector: spec.selector.clone(),
                selector,
                value: spec.value.clone(),
                redact: spec.redact,
            })
            .collect::<Vec<_>>();

        let submit = match (options.submit.as_ref(), self.submit_selector) {
            (Some(spec), Some(selector)) => Some(ResolvedSubmitSpec {
                original_selector: spec.selector.clone(),
                selector,
                kind: spec.kind,
                wait_after_ms: spec.wait_after_ms,
            }),
            _ => None,
        };

        ResolvedActionPlan {
            fields,
            submit,
            snapshot_selector: options.snapshot_selector.clone(),
        }
    }
}

impl SemanticRetrySupervisor {
    fn new(options: &WebActionOptions) -> Self {
        let fields = options
            .fields
            .iter()
            .map(|field| SelectorState::new(field.selector.clone()))
            .collect();
        let submit = options
            .submit
            .as_ref()
            .map(|submit| SelectorState::new(submit.selector.clone()));

        Self {
            fields,
            submit,
            attempts: 0,
        }
    }

    fn begin_attempt(&mut self) -> Result<AttemptSelectors> {
        if self.is_exhausted() {
            return Err(WebExecutorError::SelectorsExhausted {
                attempts: self.attempts,
                attempted: self.history(),
            });
        }

        self.attempts += 1;

        let field_selectors = self
            .fields
            .iter()
            .map(|state| {
                state
                    .current()
                    .cloned()
                    .ok_or_else(|| WebExecutorError::SelectorsExhausted {
                        attempts: self.attempts,
                        attempted: self.history(),
                    })
            })
            .collect::<Result<Vec<_>>>()?;

        let submit_selector = match self.submit.as_ref() {
            Some(state) => Some(state.current().cloned().ok_or_else(|| {
                WebExecutorError::SelectorsExhausted {
                    attempts: self.attempts,
                    attempted: self.history(),
                }
            })?),
            None => None,
        };

        Ok(AttemptSelectors {
            field_selectors,
            submit_selector,
        })
    }

    fn register_fallback(&mut self, details: &[SelectorRetryDetail]) -> usize {
        let mut total_pending = 0;

        for detail in details {
            match detail.role {
                SelectorRole::Field { index } => {
                    if let Some(state) = self.fields.get_mut(index) {
                        state.advance();
                        state.record_attempted(&detail.attempted);
                        state.push_suggestions(&detail.suggestions);
                        total_pending += state.pending_len();
                    }
                }
                SelectorRole::Submit => {
                    if let Some(state) = self.submit.as_mut() {
                        state.advance();
                        state.record_attempted(&detail.attempted);
                        state.push_suggestions(&detail.suggestions);
                        total_pending += state.pending_len();
                    }
                }
            }
        }

        total_pending
    }

    fn attempts(&self) -> u32 {
        self.attempts
    }

    fn is_exhausted(&self) -> bool {
        self.fields.iter().any(SelectorState::exhausted)
            || self.submit.as_ref().is_some_and(SelectorState::exhausted)
    }

    fn history(&self) -> Vec<SelectorAttemptSummary> {
        let mut summaries = Vec::with_capacity(self.fields.len() + 1);

        for (index, state) in self.fields.iter().enumerate() {
            summaries.push(SelectorAttemptSummary {
                role: SelectorRole::Field { index },
                tried: state.attempted.clone(),
            });
        }

        if let Some(state) = self.submit.as_ref() {
            summaries.push(SelectorAttemptSummary {
                role: SelectorRole::Submit,
                tried: state.attempted.clone(),
            });
        }

        summaries
    }
}

impl SelectorState {
    fn new(initial: String) -> Self {
        let mut queue = VecDeque::new();
        queue.push_back(initial);
        Self {
            queue,
            attempted: Vec::new(),
        }
    }

    fn current(&self) -> Option<&String> {
        self.queue.front()
    }

    fn advance(&mut self) {
        if let Some(front) = self.queue.pop_front() {
            self.attempted.push(front);
        }
    }

    fn push_suggestions(&mut self, suggestions: &[String]) -> usize {
        let mut added = 0;
        for suggestion in suggestions {
            if self.contains(suggestion) {
                continue;
            }
            self.queue.push_back(suggestion.clone());
            added += 1;
        }
        added
    }

    fn contains(&self, candidate: &str) -> bool {
        self.queue.iter().any(|value| value == candidate)
            || self.attempted.iter().any(|value| value == candidate)
    }

    fn record_attempted(&mut self, attempted: &[String]) {
        for selector in attempted {
            if !self.attempted.iter().any(|value| value == selector) {
                self.attempted.push(selector.clone());
            }
        }
    }

    fn exhausted(&self) -> bool {
        self.queue.is_empty()
    }

    fn pending_len(&self) -> usize {
        self.queue.len()
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

    let submit = action
        .args
        .get("submit")
        .map(|value| {
            serde_json::from_value::<SubmitActionSpec>(value.clone()).map_err(|source| {
                WebExecutorError::InvalidArgument {
                    argument: "submit",
                    source,
                }
            })
        })
        .transpose()?;

    if submit
        .as_ref()
        .is_some_and(|submit| submit.selector.trim().is_empty())
    {
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

async fn fill_fields(page: &Page, fields: &[ResolvedFieldSpec]) -> Result<()> {
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

async fn submit_form(page: &Page, submit: &ResolvedSubmitSpec) -> Result<()> {
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

                        throw new Error('submit selector is not associated with a form');
                    }",
                Option::<()>::None,
            )
            .await?;
        }
    }

    Ok(())
}

async fn wait_for_post_submit(page: &Page, submit: &ResolvedSubmitSpec) -> Result<()> {
    let _ = page
        .wait_for_function_builder("() => document.readyState === 'complete'")
        .wait_for_function()
        .await?;

    if let Some(wait_ms) = submit.wait_after_ms {
        page.wait_for_timeout(wait_ms as f64).await;
    }

    Ok(())
}

async fn capture_dom_excerpt(
    page: &Page,
    selector: Option<&str>,
    fields: &[ResolvedFieldSpec],
) -> Result<DomExcerpt> {
    let mut selector = selector.unwrap_or("body");

    let redacted_selectors = redact_selectors(fields);
    let mut html = snapshot_with_selector(page, selector, redacted_selectors.clone()).await;

    if selector != "body"
        && let Err(err) = html.as_ref()
    {
        tracing::warn!(
            selector = selector,
            %err,
            "snapshot selector failed; falling back to body"
        );
        selector = "body";
        html = snapshot_with_selector(page, selector, redacted_selectors).await;
    }

    let html = html.unwrap_or_else(|err| {
        tracing::warn!(%err, "body snapshot failed; returning empty excerpt");
        None
    });

    Ok(DomExcerpt {
        selector: selector.to_string(),
        html: html.unwrap_or_default(),
    })
}

fn redact_selectors(fields: &[ResolvedFieldSpec]) -> Vec<String> {
    fields
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
    fields: &[ResolvedFieldSpec],
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
    fields: &[ResolvedFieldSpec],
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
    #![allow(clippy::expect_used, clippy::unwrap_used)]

    use super::*;
    use once_cell::sync::Lazy;
    use opentelemetry::{Value, global};
    use opentelemetry_sdk::metrics::{
        InMemoryMetricExporter, PeriodicReader, SdkMeterProvider,
        data::{AggregatedMetrics, HistogramDataPoint, MetricData, SumDataPoint},
    };
    use serde_json::json;
    use std::{
        fmt,
        sync::{Arc, Mutex as StdMutex},
    };
    use tokio::sync::Mutex as AsyncMutex;
    use tracing::subscriber::set_default;
    use tracing::{
        Id, Subscriber,
        field::{Field, Visit},
    };
    use tracing_subscriber::{
        Layer, Registry, layer::Context, layer::SubscriberExt, registry::LookupSpan,
    };
    use tyrum_shared::planner::ActionArguments;
    use tyrum_shared::{AssertionFailureCode, AssertionOutcome};

    static TELEMETRY_GUARD: Lazy<AsyncMutex<()>> = Lazy::new(|| AsyncMutex::new(()));

    #[derive(Clone, Debug, Default)]
    struct CapturedSpan {
        attempt: Option<i64>,
        outcome: Option<String>,
        host: Option<String>,
    }

    struct RecordingLayer {
        spans: Arc<StdMutex<Vec<CapturedSpan>>>,
    }

    impl RecordingLayer {
        fn new(spans: Arc<StdMutex<Vec<CapturedSpan>>>) -> Self {
            Self { spans }
        }

        fn push(&self, span: CapturedSpan) {
            self.spans.lock().unwrap().push(span);
        }
    }

    struct FieldVisitor<'a> {
        span: &'a mut CapturedSpan,
    }

    impl<'a> FieldVisitor<'a> {
        fn record_str(&mut self, field: &Field, value: &str) {
            match field.name() {
                "outcome" => self.span.outcome = Some(value.to_owned()),
                "target_host" => self.span.host = Some(value.to_owned()),
                _ => {}
            }
        }
    }

    impl<'a> Visit for FieldVisitor<'a> {
        fn record_str(&mut self, field: &Field, value: &str) {
            self.record_str(field, value);
        }

        fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
            self.record_str(field, &format!("{value:?}"));
        }

        fn record_i64(&mut self, field: &Field, value: i64) {
            if field.name() == "attempt" {
                self.span.attempt = Some(value);
            }
        }

        fn record_u64(&mut self, field: &Field, value: u64) {
            if field.name() == "attempt" {
                self.span.attempt = Some(value as i64);
            }
        }
    }

    impl<S> Layer<S> for RecordingLayer
    where
        S: Subscriber + for<'lookup> LookupSpan<'lookup>,
    {
        fn on_new_span(&self, attrs: &tracing::span::Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
            if let Some(span) = ctx.span(id) {
                let mut data = CapturedSpan::default();
                attrs.record(&mut FieldVisitor { span: &mut data });
                span.extensions_mut().insert(data);
            }
        }

        fn on_record(&self, id: &Id, values: &tracing::span::Record<'_>, ctx: Context<'_, S>) {
            if let Some(span) = ctx.span(id)
                && let Some(data) = span.extensions_mut().get_mut::<CapturedSpan>()
            {
                values.record(&mut FieldVisitor { span: data });
            }
        }

        fn on_close(&self, id: Id, ctx: Context<'_, S>) {
            if let Some(span) = ctx.span(&id)
                && let Some(data) = span.extensions_mut().remove::<CapturedSpan>()
            {
                self.push(data);
            }
        }
    }

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
    async fn errors_on_empty_submit_selector() {
        let args = ActionArguments::from_iter([
            (String::from("url"), json!("https://example.test")),
            (
                String::from("submit"),
                json!({
                    "selector": "   ",
                    "kind": "click"
                }),
            ),
        ]);
        let primitive = ActionPrimitive::new(ActionPrimitiveKind::Web, args);
        let err = execute_web_action(&primitive)
            .await
            .expect_err("empty submit selector");
        assert!(matches!(
            err,
            WebExecutorError::InvalidArgumentValue { argument, .. }
            if argument == "submit.selector"
        ));
    }

    #[test]
    fn postcondition_success_sets_report() {
        let action = ActionPrimitive::new(ActionPrimitiveKind::Web, ActionArguments::default())
            .with_postcondition(json!({
                "type": "dom_contains",
                "text": "Welcome"
            }));

        let mut outcome = WebActionOutcome {
            current_url: "https://example.test".into(),
            title: "Example".into(),
            dom_excerpt: DomExcerpt {
                selector: "body".into(),
                html: "<body><h1>Welcome</h1></body>".into(),
            },
            submitted_fields: Vec::new(),
            browser: BrowserFlavor::Chromium,
            postcondition: None,
        };

        evaluate_postcondition_report(&action, &mut outcome)
            .expect("postcondition evaluation succeeds");
        let report = outcome.postcondition.expect("report present");
        assert!(report.passed);
        assert!(
            report
                .assertions
                .iter()
                .all(|item| matches!(item.outcome, AssertionOutcome::Passed { .. }))
        );
    }

    #[test]
    fn postcondition_failure_returns_structured_error() {
        let action = ActionPrimitive::new(ActionPrimitiveKind::Web, ActionArguments::default())
            .with_postcondition(json!({
                "assertions": [
                    { "type": "dom_contains", "text": "Missing" }
                ]
            }));

        let mut outcome = WebActionOutcome {
            current_url: "https://example.test".into(),
            title: "Example".into(),
            dom_excerpt: DomExcerpt {
                selector: "body".into(),
                html: "<body><h1>Welcome</h1></body>".into(),
            },
            submitted_fields: Vec::new(),
            browser: BrowserFlavor::Chromium,
            postcondition: None,
        };

        let err = evaluate_postcondition_report(&action, &mut outcome)
            .expect_err("postcondition should fail");
        match err {
            WebExecutorError::PostconditionFailed { report } => {
                assert!(!report.passed);
                let failure = report
                    .assertions
                    .iter()
                    .find_map(|item| match &item.outcome {
                        AssertionOutcome::Failed { code, .. } => Some(code),
                        AssertionOutcome::Passed { .. } => None,
                    })
                    .expect("failing assertion");
                assert_eq!(*failure, AssertionFailureCode::DomTextMissing);
            }
            other => panic!("unexpected error variant: {:?}", other),
        }
    }

    #[test]
    fn unsupported_postcondition_surfaces_error() {
        let action = ActionPrimitive::new(ActionPrimitiveKind::Web, ActionArguments::default())
            .with_postcondition(json!({
                "type": "screenshot_matches",
                "hash": "abc123"
            }));

        let mut outcome = WebActionOutcome {
            current_url: "https://example.test".into(),
            title: "Example".into(),
            dom_excerpt: DomExcerpt {
                selector: "body".into(),
                html: "<body><h1>Welcome</h1></body>".into(),
            },
            submitted_fields: Vec::new(),
            browser: BrowserFlavor::Chromium,
            postcondition: None,
        };

        let err = evaluate_postcondition_report(&action, &mut outcome)
            .expect_err("unsupported postcondition should fail");
        match err {
            WebExecutorError::UnsupportedPostcondition { type_name } => {
                assert_eq!(type_name, "screenshot_matches");
            }
            other => panic!("unexpected error variant: {:?}", other),
        }
    }

    #[tokio::test]
    async fn retries_transient_failure_and_records_telemetry() {
        let _lock = TELEMETRY_GUARD.lock().await;

        let exporter = InMemoryMetricExporter::default();
        let reader = PeriodicReader::builder(exporter.clone()).build();
        let meter_provider = SdkMeterProvider::builder().with_reader(reader).build();
        global::set_meter_provider(meter_provider.clone());

        let spans = Arc::new(StdMutex::new(Vec::new()));
        let subscriber = Registry::default().with(RecordingLayer::new(spans.clone()));
        let guard = set_default(subscriber);

        let attempts = Arc::new(StdMutex::new(Vec::new()));
        let attempts_for_closure = attempts.clone();

        let context = AttemptContext::from_url(&Url::parse("https://example.test/login").unwrap());
        let result = execute_with_retry(&context, move |attempt| {
            let attempts = attempts_for_closure.clone();
            async move {
                attempts.lock().unwrap().push(attempt);
                if attempt == 1 {
                    Err(WebExecutorError::TestTransient("flaky"))
                } else {
                    Ok(())
                }
            }
        })
        .await;

        drop(guard);

        assert!(result.is_ok(), "expected retry to succeed");
        assert_eq!(*attempts.lock().unwrap(), vec![1, 2]);

        meter_provider.force_flush().expect("force flush metrics");
        meter_provider.shutdown().expect("shutdown meter provider");
        global::set_meter_provider(SdkMeterProvider::builder().build());

        let span_records = spans.lock().unwrap().clone();
        assert_eq!(span_records.len(), 2);
        let outcomes: Vec<_> = span_records
            .iter()
            .map(|span| span.outcome.clone().unwrap_or_default())
            .collect();
        assert_eq!(outcomes, vec!["error", "success"]);
        let attempts_recorded: Vec<_> = span_records
            .iter()
            .map(|span| span.attempt.unwrap_or_default())
            .collect();
        assert_eq!(attempts_recorded, vec![1, 2]);

        let metrics = exporter.get_finished_metrics().expect("metrics available");

        let first_hist = find_histogram_point(
            &metrics,
            "tyrum_executor_web_attempt_duration_seconds",
            "error",
            1,
        )
        .expect("first attempt histogram");
        assert_eq!(first_hist.count(), 1);

        let second_hist = find_histogram_point(
            &metrics,
            "tyrum_executor_web_attempt_duration_seconds",
            "success",
            2,
        )
        .expect("second attempt histogram");
        assert_eq!(second_hist.count(), 1);

        let first_sum = find_sum_point(&metrics, "tyrum_executor_web_attempt_total", "error", 1)
            .expect("first attempt counter");
        assert_eq!(first_sum.value(), 1);

        let second_sum = find_sum_point(&metrics, "tyrum_executor_web_attempt_total", "success", 2)
            .expect("second attempt counter");
        assert_eq!(second_sum.value(), 1);
    }

    fn find_histogram_point<'a>(
        metrics: &'a [opentelemetry_sdk::metrics::data::ResourceMetrics],
        metric_name: &str,
        outcome: &str,
        attempt: i64,
    ) -> Option<&'a HistogramDataPoint<f64>> {
        metrics
            .iter()
            .flat_map(|resource| resource.scope_metrics())
            .flat_map(|scope| scope.metrics())
            .find_map(|metric| {
                if metric.name() != metric_name {
                    return None;
                }

                match metric.data() {
                    AggregatedMetrics::F64(MetricData::Histogram(hist)) => hist
                        .data_points()
                        .find(|point| matches_attr(point.attributes(), outcome, attempt)),
                    _ => None,
                }
            })
    }

    fn find_sum_point<'a>(
        metrics: &'a [opentelemetry_sdk::metrics::data::ResourceMetrics],
        metric_name: &str,
        outcome: &str,
        attempt: i64,
    ) -> Option<&'a SumDataPoint<u64>> {
        metrics
            .iter()
            .flat_map(|resource| resource.scope_metrics())
            .flat_map(|scope| scope.metrics())
            .find_map(|metric| {
                if metric.name() != metric_name {
                    return None;
                }

                match metric.data() {
                    AggregatedMetrics::U64(MetricData::Sum(sum)) => sum
                        .data_points()
                        .find(|point| matches_attr(point.attributes(), outcome, attempt)),
                    _ => None,
                }
            })
    }

    fn matches_attr<'a>(
        attrs: impl Iterator<Item = &'a opentelemetry::KeyValue>,
        outcome: &str,
        attempt: i64,
    ) -> bool {
        let mut outcome_match = false;
        let mut attempt_match = false;

        for kv in attrs {
            if kv.key.as_str() == "executor.web.outcome" {
                if let Value::String(ref value) = kv.value {
                    outcome_match = value.as_ref() == outcome;
                }
            } else if kv.key.as_str() == "executor.web.attempt_number"
                && let Value::I64(value) = kv.value
            {
                attempt_match = value == attempt;
            }
        }

        outcome_match && attempt_match
    }
}
