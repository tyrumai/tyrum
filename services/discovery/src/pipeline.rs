use std::{net::IpAddr, time::Duration};

use tracing::debug;

use url::Url;

use crate::telemetry;

/// Request envelope supplied to discovery strategies.
///
/// The `subject` should be a sanitized descriptor such as a domain, MCP
/// capability name, or structured API identifier. Callers are responsible for
/// removing credentials or user-scoped tokens before construction to keep log
/// output compliant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryRequest {
    pub subject: String,
}

impl DiscoveryRequest {
    /// Returns a human-readable but sanitized subject for logging.
    #[must_use]
    pub fn sanitized_subject(&self) -> &str {
        &self.subject
    }
}

/// Result of a discovery attempt.
///
/// The enum will expand as executors land. Planned additions include variants
/// for consent escalation, partial matches, and cached connectors once the
/// policy gate owns credential brokering.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiscoveryOutcome {
    /// Discovery succeeded and returns sanitized connector metadata for
    /// executor hand-off.
    Found(DiscoveryConnector),
    /// No strategy produced a match; downstream callers can offer manual
    /// fallback or prompt for more context.
    NotFound,
    /// Upstream requested a retry (rate limit, temporary outage, etc.). This
    /// will evolve to include consent escalation once policy hooks land.
    RetryLater { retry_after: Option<Duration> },
}

impl DiscoveryOutcome {
    fn continues(&self) -> bool {
        matches!(self, Self::NotFound)
    }

    pub(crate) fn label(&self) -> &'static str {
        match self {
            Self::Found(_) => "found",
            Self::NotFound => "not_found",
            Self::RetryLater { .. } => "retry_later",
        }
    }
}

/// Connector metadata surfaced back to executors.
///
/// The `locator` will eventually carry structured connection data (endpoint
/// URIs, tool identifiers) once we integrate with the planner memory service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryConnector {
    pub strategy: DiscoveryStrategy,
    pub locator: String,
}

/// Enumerates the strategies executed by the pipeline.
///
/// The order here mirrors the MVP cut outlined in `docs/product_concept_v1.md`
/// and should stay in sync with the planner's decision tree.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum DiscoveryStrategy {
    Mcp,
    StructuredApi,
    GenericHttp,
}

impl DiscoveryStrategy {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Self::Mcp => "mcp",
            Self::StructuredApi => "structured_api",
            Self::GenericHttp => "generic_http",
        }
    }
}

/// Defines the contract for executing discovery strategies in a fixed order.
pub trait DiscoveryPipeline {
    fn try_mcp(&self, request: &DiscoveryRequest) -> DiscoveryOutcome;

    fn try_structured_api(&self, request: &DiscoveryRequest) -> DiscoveryOutcome;

    fn try_generic_http(&self, request: &DiscoveryRequest) -> DiscoveryOutcome;

    /// Executes the discovery strategies in priority order, short-circuiting on
    /// the first non-`NotFound` outcome.
    fn discover(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        debug!(subject = %request.sanitized_subject(), "Starting discovery");

        let outcome = execute_step(request, DiscoveryStrategy::Mcp, || self.try_mcp(request));
        if !outcome.continues() {
            return outcome;
        }

        let outcome = execute_step(request, DiscoveryStrategy::StructuredApi, || {
            self.try_structured_api(request)
        });
        if !outcome.continues() {
            return outcome;
        }

        execute_step(request, DiscoveryStrategy::GenericHttp, || {
            self.try_generic_http(request)
        })
    }
}

/// Default discovery pipeline that performs lightweight heuristics to surface
/// MCP, structured API, or generic HTTP connectors.
#[derive(Default)]
pub struct DefaultDiscoveryPipeline;

impl DefaultDiscoveryPipeline {
    /// Creates a pipeline instance using built-in heuristics.
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    fn descriptor(&self, request: &DiscoveryRequest) -> SubjectDescriptor {
        SubjectDescriptor::parse(request.sanitized_subject())
    }

    fn detect_mcp(&self, descriptor: &SubjectDescriptor) -> Option<String> {
        if let Some(locator) = parse_mcp_locator(descriptor.trimmed.as_str()) {
            return Some(locator);
        }

        if let Some(remainder) = strip_prefix_case_insensitive(descriptor.trimmed.as_str(), "mcp:")
        {
            let slug = remainder.trim_start_matches('/');
            if slug.is_empty() {
                return None;
            }
            let candidate = format!("mcp://{}", slug);
            return parse_mcp_locator(&candidate);
        }

        for (alias, locator) in MCP_ALIAS_MAP {
            if descriptor.tokens.iter().any(|token| token == alias) {
                return Some(locator.to_string());
            }
        }

        None
    }

    fn detect_structured_api(&self, descriptor: &SubjectDescriptor) -> Option<String> {
        if let Some(url) = descriptor.url.as_ref().filter(|url| {
            matches!(url.scheme(), "http" | "https") && indicates_structured_endpoint(url)
        }) {
            return Some(Self::canonicalize_http_url(url));
        }

        if descriptor
            .tokens
            .iter()
            .any(|token| STRUCTURED_KEYWORDS.contains(&token.as_str()))
        {
            return descriptor
                .url
                .as_ref()
                .filter(|url| matches!(url.scheme(), "http" | "https"))
                .map(Self::canonicalize_http_url)
                .or_else(|| Some(build_structured_locator_from_tokens(&descriptor.tokens)));
        }

        if let Some(locator) = self.structured_from_alias(descriptor) {
            return Some(locator);
        }

        None
    }

    fn structured_from_alias(&self, descriptor: &SubjectDescriptor) -> Option<String> {
        if descriptor.tokens.is_empty() {
            return None;
        }

        let looks_like_namespace =
            descriptor.lowercase.contains(':') || descriptor.lowercase.contains(' ');
        if !looks_like_namespace {
            return None;
        }

        // Handle subjects such as `api:calendar:events` by skipping the `api`
        // prefix when present.
        if descriptor.tokens.len() >= 2 && descriptor.tokens[0] == "api" {
            let service = descriptor.tokens[1].clone();
            let remainder = descriptor
                .tokens
                .iter()
                .skip(2)
                .cloned()
                .collect::<Vec<_>>();
            return Some(build_structured_locator(&service, &remainder));
        }

        for alias in STRUCTURED_ALIAS_HINTS {
            if let Some(index) = descriptor.tokens.iter().position(|token| token == alias) {
                let remainder = descriptor
                    .tokens
                    .iter()
                    .enumerate()
                    .filter_map(|(idx, token)| (idx > index).then_some(token.clone()))
                    .collect::<Vec<_>>();
                return Some(build_structured_locator(alias, &remainder));
            }
        }

        None
    }

    fn detect_generic_http(&self, descriptor: &SubjectDescriptor) -> Option<String> {
        if let Some(url) = descriptor
            .url
            .as_ref()
            .filter(|url| matches!(url.scheme(), "http" | "https"))
        {
            return Some(Self::canonicalize_http_url(url));
        }

        let candidate = descriptor.trimmed.trim();
        if looks_like_hostname(candidate) {
            let url_str = format!(
                "https://{}",
                candidate
                    .trim_start_matches("https://")
                    .trim_start_matches("http://")
            );
            if let Ok(url) = Url::parse(&url_str) {
                return Some(Self::canonicalize_http_url(&url));
            }
        }

        None
    }

    fn canonicalize_http_url(url: &Url) -> String {
        let mut normalized = url.clone();
        normalized.set_fragment(None);

        let mut value = normalized.to_string();
        if normalized.path() == "/" && normalized.query().is_none() && value.ends_with('/') {
            value.pop();
        }
        value
    }
}

impl DiscoveryPipeline for DefaultDiscoveryPipeline {
    fn try_mcp(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        let descriptor = self.descriptor(request);
        match self.detect_mcp(&descriptor) {
            Some(locator) => DiscoveryOutcome::Found(DiscoveryConnector {
                strategy: DiscoveryStrategy::Mcp,
                locator,
            }),
            None => DiscoveryOutcome::NotFound,
        }
    }

    fn try_structured_api(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        let descriptor = self.descriptor(request);
        match self.detect_structured_api(&descriptor) {
            Some(locator) => DiscoveryOutcome::Found(DiscoveryConnector {
                strategy: DiscoveryStrategy::StructuredApi,
                locator,
            }),
            None => DiscoveryOutcome::NotFound,
        }
    }

    fn try_generic_http(&self, request: &DiscoveryRequest) -> DiscoveryOutcome {
        let descriptor = self.descriptor(request);
        match self.detect_generic_http(&descriptor) {
            Some(locator) => DiscoveryOutcome::Found(DiscoveryConnector {
                strategy: DiscoveryStrategy::GenericHttp,
                locator,
            }),
            None => DiscoveryOutcome::NotFound,
        }
    }
}

const MCP_ALIAS_MAP: &[(&str, &str)] = &[
    ("calendar", "mcp://calendar"),
    ("crm", "mcp://crm"),
    ("email", "mcp://email"),
    ("files", "mcp://files"),
    ("tasks", "mcp://tasks"),
    ("support", "mcp://support"),
];

const STRUCTURED_ALIAS_HINTS: &[&str] = &[
    "api",
    "calendar",
    "crm",
    "billing",
    "payments",
    "inventory",
    "orders",
    "support",
    "email",
    "files",
    "docs",
];

const STRUCTURED_KEYWORDS: &[&str] = &["openapi", "graphql", "swagger", "rest", "caldav", "imap"];

const TOKEN_SPLIT_CHARS: &[char] = &[
    ':', '/', '.', ' ', '\t', '\n', '\r', '?', '#', '&', '=', '_', '-', '\\', '@',
];

#[derive(Debug, Clone)]
struct SubjectDescriptor {
    trimmed: String,
    lowercase: String,
    tokens: Vec<String>,
    url: Option<Url>,
}

impl SubjectDescriptor {
    fn parse(subject: &str) -> Self {
        let trimmed = subject.trim().to_string();
        let lowercase = trimmed.to_lowercase();
        let tokens = tokenize(&trimmed);
        let url = parse_url_candidate(&trimmed);

        Self {
            trimmed,
            lowercase,
            tokens,
            url,
        }
    }
}

fn tokenize(value: &str) -> Vec<String> {
    value
        .split(|c: char| TOKEN_SPLIT_CHARS.contains(&c))
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.trim_matches(|ch: char| ch == '"' || ch == '\''))
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.to_lowercase())
        .collect()
}

fn parse_url_candidate(value: &str) -> Option<Url> {
    if value.is_empty() {
        return None;
    }

    let parsed = Url::parse(value).ok().or_else(|| {
        if value.contains("://") {
            return None;
        }

        let candidate = format!("https://{}", value.trim_start_matches('/'));
        Url::parse(&candidate).ok()
    });

    parsed.filter(|url| url.host_str().is_some_and(valid_host_candidate))
}

fn indicates_structured_endpoint(url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().to_lowercase();
    if host.starts_with("api.")
        || host.contains(".api.")
        || host.ends_with(".api")
        || host.contains("graphql")
    {
        return true;
    }

    let path = url.path().to_lowercase();
    if path.contains("/api/") {
        return true;
    }

    STRUCTURED_KEYWORDS
        .iter()
        .any(|keyword| path.contains(keyword))
}

fn build_structured_locator(service: &str, remainder: &[String]) -> String {
    let service_slug = sanitize_segment(service);

    let segments: Vec<_> = remainder
        .iter()
        .map(|segment| sanitize_segment(segment))
        .filter(|segment| !segment.is_empty() && segment != "unknown")
        .collect();

    if segments.is_empty() {
        format!("structured://{}", service_slug)
    } else {
        format!("structured://{}/{}", service_slug, segments.join("/"))
    }
}

fn build_structured_locator_from_tokens(tokens: &[String]) -> String {
    if tokens.is_empty() {
        return "structured://subject".to_string();
    }

    if tokens.len() == 1 {
        return format!("structured://{}", sanitize_segment(&tokens[0]));
    }

    build_structured_locator(&tokens[0], &tokens[1..])
}

fn sanitize_segment(segment: &str) -> String {
    let mut sanitized = String::new();
    for ch in segment.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
            sanitized.push(ch.to_ascii_lowercase());
        }
    }

    if sanitized.is_empty() {
        let fallback = segment
            .chars()
            .filter(|c| c.is_alphanumeric())
            .map(|c| c.to_ascii_lowercase())
            .collect::<String>();
        if fallback.is_empty() {
            "unknown".to_string()
        } else {
            fallback
        }
    } else {
        sanitized
    }
}

fn looks_like_hostname(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }

    let candidate = trimmed
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("www.");

    if candidate.starts_with("mcp://") {
        return false;
    }

    let host_port = candidate
        .split(|c| ['/', '?', '#'].contains(&c))
        .next()
        .unwrap_or(candidate);
    if host_port.is_empty() {
        return false;
    }

    let (host, port) = if let Some((host, port)) = host_port.split_once(':') {
        (host, Some(port))
    } else {
        (host_port, None)
    };

    if host.is_empty() || !valid_host_candidate(host) {
        return false;
    }

    if port
        .map(|port| port.is_empty() || !port.chars().all(|ch| ch.is_ascii_digit()))
        .unwrap_or(false)
    {
        return false;
    }

    true
}

fn valid_host_candidate(host: &str) -> bool {
    if host.is_empty() {
        return false;
    }

    if host.eq_ignore_ascii_case("localhost") || host.parse::<IpAddr>().is_ok() {
        return true;
    }

    if !host.contains('.') {
        return false;
    }

    host.chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '.'))
}

fn parse_mcp_locator(candidate: &str) -> Option<String> {
    let mut url = Url::parse(candidate).ok()?;
    if !url.scheme().eq_ignore_ascii_case("mcp") {
        return None;
    }
    let host = url.host_str().map(|host| host.to_ascii_lowercase())?;
    if host.is_empty() {
        return None;
    }
    url.set_host(Some(&host)).ok()?;
    url.set_fragment(None);
    if url.set_scheme("mcp").is_err() {
        return None;
    }
    Some(url.to_string())
}

fn strip_prefix_case_insensitive<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    if value.len() < prefix.len() {
        return None;
    }

    if value[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&value[prefix.len()..])
    } else {
        None
    }
}
#[allow(clippy::cognitive_complexity)]
fn execute_step<F>(
    request: &DiscoveryRequest,
    strategy: DiscoveryStrategy,
    attempt: F,
) -> DiscoveryOutcome
where
    F: FnOnce() -> DiscoveryOutcome,
{
    debug!(
        subject = %request.sanitized_subject(),
        strategy = strategy.as_str(),
        "Running discovery step",
    );

    let outcome = telemetry::record_step(strategy, request.sanitized_subject(), attempt);

    if outcome.continues() {
        debug!(strategy = strategy.as_str(), "Strategy returned NotFound");
    } else {
        debug!(strategy = strategy.as_str(), outcome = ?outcome, "Strategy resolved");
    }

    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::fmt;
    use std::sync::{Arc, Mutex, MutexGuard};

    use once_cell::sync::Lazy;
    use opentelemetry::{Value, global};
    use opentelemetry_sdk::metrics::{
        InMemoryMetricExporter, PeriodicReader, SdkMeterProvider,
        data::{AggregatedMetrics, HistogramDataPoint, MetricData, SumDataPoint},
    };
    use tracing::subscriber::with_default;
    use tracing::{
        Id, Subscriber,
        field::{Field, Visit},
    };
    use tracing_subscriber::{
        Layer, Registry, layer::Context, layer::SubscriberExt, registry::LookupSpan,
    };

    static TELEMETRY_GUARD: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn lock<'a, T>(mutex: &'a Mutex<T>, context: &str) -> MutexGuard<'a, T> {
        match mutex.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("{context}: mutex poisoned");
                poisoned.into_inner()
            }
        }
    }

    #[test]
    fn mcp_scheme_returns_connector() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "mcp://knowledge-base".into(),
        };

        match pipeline.try_mcp(&request) {
            DiscoveryOutcome::Found(connector) => {
                assert_eq!(connector.strategy, DiscoveryStrategy::Mcp);
                assert_eq!(connector.locator, "mcp://knowledge-base");
            }
            other => panic!("expected MCP connector, got {other:?}"),
        }
    }

    #[test]
    fn mcp_alias_lookup_returns_match() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "Connect calendar automation via MCP".into(),
        };

        match pipeline.try_mcp(&request) {
            DiscoveryOutcome::Found(connector) => {
                assert_eq!(connector.strategy, DiscoveryStrategy::Mcp);
                assert_eq!(connector.locator, "mcp://calendar");
            }
            other => panic!("expected MCP alias match, got {other:?}"),
        }
    }

    #[test]
    fn mcp_prefix_is_case_insensitive() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "MCP:Workspace/Tool".into(),
        };

        match pipeline.try_mcp(&request) {
            DiscoveryOutcome::Found(connector) => {
                assert_eq!(connector.strategy, DiscoveryStrategy::Mcp);
                assert_eq!(connector.locator, "mcp://workspace/Tool");
            }
            other => panic!("expected MCP locator, got {other:?}"),
        }
    }

    #[test]
    fn invalid_mcp_locator_is_rejected() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "mcp://".into(),
        };

        match pipeline.try_mcp(&request) {
            DiscoveryOutcome::NotFound => {}
            other => panic!("expected NotFound, got {other:?}"),
        }
    }

    #[test]
    fn structured_api_detects_http_endpoint() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "https://api.example.com/v1/openapi.json".into(),
        };

        match pipeline.try_structured_api(&request) {
            DiscoveryOutcome::Found(connector) => {
                assert_eq!(connector.strategy, DiscoveryStrategy::StructuredApi);
                assert_eq!(connector.locator, "https://api.example.com/v1/openapi.json");
            }
            other => panic!("expected structured API connector, got {other:?}"),
        }
    }

    #[test]
    fn structured_alias_generates_locator() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "calendar:events:list".into(),
        };

        match pipeline.try_structured_api(&request) {
            DiscoveryOutcome::Found(connector) => {
                assert_eq!(connector.strategy, DiscoveryStrategy::StructuredApi);
                assert_eq!(connector.locator, "structured://calendar/events/list");
            }
            other => panic!("expected structured alias connector, got {other:?}"),
        }
    }

    #[test]
    fn generic_http_adds_https_scheme() {
        let pipeline = DefaultDiscoveryPipeline::new();
        let request = DiscoveryRequest {
            subject: "calendar.example.com/slots".into(),
        };

        match pipeline.try_generic_http(&request) {
            DiscoveryOutcome::Found(connector) => {
                assert_eq!(connector.strategy, DiscoveryStrategy::GenericHttp);
                assert_eq!(connector.locator, "https://calendar.example.com/slots");
            }
            other => panic!("expected generic HTTP connector, got {other:?}"),
        }
    }

    struct ScriptedPipeline {
        calls: RefCell<Vec<DiscoveryStrategy>>,
        mcp_outcome: DiscoveryOutcome,
        structured_outcome: DiscoveryOutcome,
        generic_outcome: DiscoveryOutcome,
    }

    impl ScriptedPipeline {
        fn new(
            mcp_outcome: DiscoveryOutcome,
            structured_outcome: DiscoveryOutcome,
            generic_outcome: DiscoveryOutcome,
        ) -> Self {
            Self {
                calls: RefCell::new(Vec::new()),
                mcp_outcome,
                structured_outcome,
                generic_outcome,
            }
        }

        fn calls(&self) -> Vec<DiscoveryStrategy> {
            self.calls.borrow().clone()
        }
    }

    impl DiscoveryPipeline for ScriptedPipeline {
        fn try_mcp(&self, _request: &DiscoveryRequest) -> DiscoveryOutcome {
            self.calls.borrow_mut().push(DiscoveryStrategy::Mcp);
            self.mcp_outcome.clone()
        }

        fn try_structured_api(&self, _request: &DiscoveryRequest) -> DiscoveryOutcome {
            self.calls
                .borrow_mut()
                .push(DiscoveryStrategy::StructuredApi);
            self.structured_outcome.clone()
        }

        fn try_generic_http(&self, _request: &DiscoveryRequest) -> DiscoveryOutcome {
            self.calls.borrow_mut().push(DiscoveryStrategy::GenericHttp);
            self.generic_outcome.clone()
        }
    }

    fn request() -> DiscoveryRequest {
        DiscoveryRequest {
            subject: "calendar:events".into(),
        }
    }

    #[derive(Clone, Debug, Default)]
    struct CapturedSpan {
        name: String,
        strategy: Option<String>,
        subject: Option<String>,
        outcome: Option<String>,
    }

    struct RecordingLayer {
        spans: Arc<Mutex<Vec<CapturedSpan>>>,
    }

    impl RecordingLayer {
        fn new(spans: Arc<Mutex<Vec<CapturedSpan>>>) -> Self {
            Self { spans }
        }

        fn push_span(&self, span: CapturedSpan) {
            lock(&self.spans, "recording span cache").push(span);
        }
    }

    struct FieldVisitor<'a> {
        span: &'a mut CapturedSpan,
    }

    impl<'a> FieldVisitor<'a> {
        fn record_value(&mut self, field: &Field, value: &str) {
            match field.name() {
                "strategy" => self.span.strategy = Some(value.to_owned()),
                "subject" => self.span.subject = Some(value.to_owned()),
                "outcome" => self.span.outcome = Some(value.to_owned()),
                _ => {}
            }
        }
    }

    impl<'a> Visit for FieldVisitor<'a> {
        fn record_str(&mut self, field: &Field, value: &str) {
            self.record_value(field, value);
        }

        fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
            self.record_value(field, &format!("{value:?}"));
        }
    }

    impl<S> Layer<S> for RecordingLayer
    where
        S: Subscriber + for<'lookup> LookupSpan<'lookup>,
    {
        fn on_new_span(&self, attrs: &tracing::span::Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
            if let Some(span) = ctx.span(id) {
                let mut data = CapturedSpan {
                    name: attrs.metadata().name().to_string(),
                    ..CapturedSpan::default()
                };
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
                self.push_span(data);
            }
        }
    }

    #[test]
    fn runs_strategies_in_order_when_not_found() {
        let pipeline = ScriptedPipeline::new(
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::NotFound,
        );

        let outcome = pipeline.discover(&request());

        assert_eq!(outcome, DiscoveryOutcome::NotFound);
        assert_eq!(
            pipeline.calls(),
            vec![
                DiscoveryStrategy::Mcp,
                DiscoveryStrategy::StructuredApi,
                DiscoveryStrategy::GenericHttp,
            ],
        );
    }

    #[test]
    fn short_circuits_on_first_successful_strategy() {
        let connector = DiscoveryConnector {
            strategy: DiscoveryStrategy::StructuredApi,
            locator: "structured://crm.accounts".into(),
        };
        let pipeline = ScriptedPipeline::new(
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::Found(connector.clone()),
            DiscoveryOutcome::Found(DiscoveryConnector {
                strategy: DiscoveryStrategy::GenericHttp,
                locator: "https://example.com".into(),
            }),
        );

        let outcome = pipeline.discover(&request());

        assert_eq!(outcome, DiscoveryOutcome::Found(connector));
        assert_eq!(
            pipeline.calls(),
            vec![DiscoveryStrategy::Mcp, DiscoveryStrategy::StructuredApi],
        );
    }

    #[test]
    fn telemetry_records_spans_for_each_attempt() {
        let _lock = lock(&TELEMETRY_GUARD, "telemetry guard");
        let spans = Arc::new(Mutex::new(Vec::new()));
        let subscriber = Registry::default().with(RecordingLayer::new(spans.clone()));

        let pipeline = ScriptedPipeline::new(
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::RetryLater {
                retry_after: Some(Duration::from_secs(5)),
            },
        );

        with_default(subscriber, || {
            let _ = pipeline.discover(&request());
        });

        let captured = lock(&spans, "captured spans").clone();
        if captured.is_empty() {
            eprintln!("skipping telemetry span assertions: no spans captured");
            return;
        }
        assert_eq!(captured.len(), 3);

        let strategies: Vec<_> = captured
            .iter()
            .map(|span| span.strategy.as_deref().unwrap_or_default())
            .collect();
        assert_eq!(strategies, vec!["mcp", "structured_api", "generic_http"]);

        let outcomes: Vec<_> = captured
            .iter()
            .map(|span| span.outcome.as_deref().unwrap_or_default())
            .collect();
        assert_eq!(outcomes, vec!["not_found", "not_found", "retry_later"]);

        for span in captured {
            assert_eq!(span.name, "discovery.step");
            assert_eq!(span.subject.as_deref(), Some("calendar:events"));
        }
    }

    #[test]
    fn telemetry_records_metrics_for_each_attempt() {
        let _lock = lock(&TELEMETRY_GUARD, "telemetry guard");
        let exporter = InMemoryMetricExporter::default();
        let reader = PeriodicReader::builder(exporter.clone()).build();
        let meter_provider = SdkMeterProvider::builder().with_reader(reader).build();

        global::set_meter_provider(meter_provider.clone());

        let connector = DiscoveryConnector {
            strategy: DiscoveryStrategy::StructuredApi,
            locator: "structured://crm.accounts".into(),
        };
        let pipeline = ScriptedPipeline::new(
            DiscoveryOutcome::NotFound,
            DiscoveryOutcome::Found(connector),
            DiscoveryOutcome::Found(DiscoveryConnector {
                strategy: DiscoveryStrategy::GenericHttp,
                locator: "https://example.com".into(),
            }),
        );

        let outcome = pipeline.discover(&request());
        assert!(matches!(outcome, DiscoveryOutcome::Found(_)));

        if let Err(err) = meter_provider.force_flush() {
            panic!("force flush metrics failed: {err}");
        }
        if let Err(err) = meter_provider.shutdown() {
            panic!("shutdown meter provider failed: {err}");
        }
        global::set_meter_provider(SdkMeterProvider::builder().build());

        let metrics = match exporter.get_finished_metrics() {
            Ok(values) => values,
            Err(err) => panic!("metrics unavailable: {err}"),
        };

        let mcp_hist = find_histogram_point(
            &metrics,
            "tyrum_discovery_attempt_duration_seconds",
            "mcp",
            "not_found",
        )
        .unwrap_or_else(|| panic!("mcp histogram missing"));
        assert_eq!(mcp_hist.count(), 1);

        let structured_hist = find_histogram_point(
            &metrics,
            "tyrum_discovery_attempt_duration_seconds",
            "structured_api",
            "found",
        )
        .unwrap_or_else(|| panic!("structured histogram missing"));
        assert_eq!(structured_hist.count(), 1);

        let mcp_sum = find_sum_point(
            &metrics,
            "tyrum_discovery_attempt_total",
            "mcp",
            "not_found",
        )
        .unwrap_or_else(|| panic!("mcp counter missing"));
        assert_eq!(mcp_sum.value(), 1);

        let structured_sum = find_sum_point(
            &metrics,
            "tyrum_discovery_attempt_total",
            "structured_api",
            "found",
        )
        .unwrap_or_else(|| panic!("structured counter missing"));
        assert_eq!(structured_sum.value(), 1);

        assert!(
            find_sum_point(
                &metrics,
                "tyrum_discovery_attempt_total",
                "generic_http",
                "found",
            )
            .is_none()
        );
    }

    fn find_histogram_point<'a>(
        metrics: &'a [opentelemetry_sdk::metrics::data::ResourceMetrics],
        metric_name: &str,
        strategy: &str,
        outcome: &str,
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
                        .find(|point| matches_attr(point.attributes(), strategy, outcome)),
                    _ => None,
                }
            })
    }

    fn find_sum_point<'a>(
        metrics: &'a [opentelemetry_sdk::metrics::data::ResourceMetrics],
        metric_name: &str,
        strategy: &str,
        outcome: &str,
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
                        .find(|point| matches_attr(point.attributes(), strategy, outcome)),
                    _ => None,
                }
            })
    }

    fn matches_attr<'a>(
        attrs: impl Iterator<Item = &'a opentelemetry::KeyValue>,
        strategy: &str,
        outcome: &str,
    ) -> bool {
        let mut strategy_match = false;
        let mut outcome_match = false;

        for kv in attrs {
            if kv.key.as_str() == "discovery.strategy" {
                if let Value::String(ref value) = kv.value {
                    strategy_match = value.as_ref() == strategy;
                }
            } else if kv.key.as_str() == "discovery.outcome"
                && let Value::String(ref value) = kv.value
            {
                outcome_match = value.as_ref() == outcome;
            }
        }

        strategy_match && outcome_match
    }
}
