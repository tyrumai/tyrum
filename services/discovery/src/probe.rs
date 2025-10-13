use std::collections::HashSet;
use std::future::Future;
use std::time::{Duration, Instant};

use reqwest::header::{HeaderMap, HeaderValue, LINK};
use reqwest::{Client, Method, StatusCode, Url};
use serde::Deserialize;
use tracing::{debug, warn};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProbeOutcome {
    Success,
    Miss,
    Timeout,
    Error,
}

#[derive(Debug)]
pub(crate) struct ProbeResult {
    pub outcome: ProbeOutcome,
    pub urls: Vec<Url>,
}

#[derive(Default)]
struct ProbeStatusTracker {
    saw_timeout: bool,
    saw_error: bool,
}

impl ProbeStatusTracker {
    fn outcome(&self, found: bool) -> ProbeOutcome {
        if found {
            ProbeOutcome::Success
        } else if self.saw_timeout {
            ProbeOutcome::Timeout
        } else if self.saw_error {
            ProbeOutcome::Error
        } else {
            ProbeOutcome::Miss
        }
    }

    fn register_timeout(&mut self, context: &str) {
        self.saw_timeout = true;
        debug!("{context} probe timed out");
    }

    fn register_transport_error(&mut self, context: &str, error: String) {
        self.saw_error = true;
        debug!(error = %error, "{context} probe failed");
    }

    fn register_error(&mut self, error: ProbeError, context: &str) {
        match error {
            ProbeError::Timeout => self.register_timeout(context),
            ProbeError::Transport { error } => self.register_transport_error(context, error),
        }
    }
}

async fn run_probe_step<F, Fut>(
    deadline: Instant,
    tracker: &mut ProbeStatusTracker,
    context: &str,
    op: F,
    collected: &mut Vec<Url>,
) where
    F: Fn(Duration) -> Fut,
    Fut: Future<Output = Result<Vec<Url>, ProbeError>>,
{
    if tracker.saw_timeout {
        return;
    }

    let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
        tracker.register_timeout(context);
        return;
    };

    if remaining.is_zero() {
        tracker.register_timeout(context);
        return;
    }

    match op(remaining).await {
        Ok(mut urls) => collected.append(&mut urls),
        Err(err) => tracker.register_error(err, context),
    }
}

pub(crate) async fn probe_structured_origin(
    client: &Client,
    origin: &Url,
    timeout: Duration,
) -> ProbeResult {
    let mut tracker = ProbeStatusTracker::default();
    let mut collected = Vec::new();
    let deadline = Instant::now() + timeout;

    run_probe_step(
        deadline,
        &mut tracker,
        "openapi well-known",
        |step_timeout| async move {
            match fetch_openapi_well_known(client, origin, step_timeout).await? {
                Some(url) => Ok(vec![url]),
                None => Ok(Vec::new()),
            }
        },
        &mut collected,
    )
    .await;

    run_probe_step(
        deadline,
        &mut tracker,
        "ai-plugin",
        |step_timeout| async move { fetch_ai_plugin(client, origin, step_timeout).await },
        &mut collected,
    )
    .await;

    run_probe_step(
        deadline,
        &mut tracker,
        "header",
        |step_timeout| async move { fetch_header_hints(client, origin, step_timeout).await },
        &mut collected,
    )
    .await;

    let deduped = dedupe_urls(collected);
    let outcome = tracker.outcome(!deduped.is_empty());

    ProbeResult {
        outcome,
        urls: deduped,
    }
}

#[derive(Debug)]
enum ProbeError {
    Timeout,
    Transport { error: String },
}

async fn fetch_openapi_well_known(
    client: &Client,
    origin: &Url,
    timeout: Duration,
) -> Result<Option<Url>, ProbeError> {
    let target = match origin.join(".well-known/openapi.json") {
        Ok(url) => url,
        Err(error) => {
            warn!(%error, origin = %origin, "failed to build openapi well-known url");
            return Ok(None);
        }
    };

    let response = client
        .get(target.clone())
        .timeout(timeout)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(map_reqwest_error)?;

    if response.status().is_success() {
        Ok(Some(target))
    } else {
        Ok(None)
    }
}

async fn fetch_ai_plugin(
    client: &Client,
    origin: &Url,
    timeout: Duration,
) -> Result<Vec<Url>, ProbeError> {
    let target = match origin.join(".well-known/ai-plugin.json") {
        Ok(url) => url,
        Err(error) => {
            warn!(%error, origin = %origin, "failed to build ai-plugin url");
            return Ok(Vec::new());
        }
    };

    let response = client
        .get(target.clone())
        .timeout(timeout)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(map_reqwest_error)?;

    if !response.status().is_success() {
        return Ok(Vec::new());
    }

    let body = response.bytes().await.map_err(map_reqwest_error)?;
    let document: AiPluginDocument = match serde_json::from_slice(&body) {
        Ok(doc) => doc,
        Err(error) => {
            warn!(%error, url = %target, "failed to parse ai-plugin.json");
            return Ok(Vec::new());
        }
    };

    let Some(api) = document.api else {
        return Ok(Vec::new());
    };

    let Some(url) = api.url.and_then(|raw| resolve_url(origin, &raw)) else {
        return Ok(Vec::new());
    };

    Ok(vec![url])
}

async fn fetch_header_hints(
    client: &Client,
    origin: &Url,
    timeout: Duration,
) -> Result<Vec<Url>, ProbeError> {
    match request_headers(client, origin, Method::HEAD, timeout).await {
        Ok(Some(headers)) => return Ok(parse_header_hints(&headers, origin)),
        Ok(None) => {}
        Err(HeaderProbeError::Timeout) => return Err(ProbeError::Timeout),
        Err(HeaderProbeError::Transport { error }) => {
            return Err(ProbeError::Transport { error });
        }
    }

    match request_headers(client, origin, Method::OPTIONS, timeout).await {
        Ok(Some(headers)) => Ok(parse_header_hints(&headers, origin)),
        Ok(None) => Ok(Vec::new()),
        Err(HeaderProbeError::Timeout) => Err(ProbeError::Timeout),
        Err(HeaderProbeError::Transport { error }) => Err(ProbeError::Transport { error }),
    }
}

enum HeaderProbeError {
    Timeout,
    Transport { error: String },
}

async fn request_headers(
    client: &Client,
    origin: &Url,
    method: Method,
    timeout: Duration,
) -> Result<Option<HeaderMap>, HeaderProbeError> {
    let response = client
        .request(method.clone(), origin.clone())
        .timeout(timeout)
        .send()
        .await
        .map_err(map_header_error)?;

    if response.status() == StatusCode::METHOD_NOT_ALLOWED
        || response.status() == StatusCode::NOT_IMPLEMENTED
    {
        return Ok(None);
    }

    if response.status().is_success() {
        Ok(Some(response.headers().clone()))
    } else {
        Ok(None)
    }
}

fn map_reqwest_error(error: reqwest::Error) -> ProbeError {
    if error.is_timeout() {
        ProbeError::Timeout
    } else {
        ProbeError::Transport {
            error: error.to_string(),
        }
    }
}

fn map_header_error(error: reqwest::Error) -> HeaderProbeError {
    if error.is_timeout() {
        HeaderProbeError::Timeout
    } else {
        HeaderProbeError::Transport {
            error: error.to_string(),
        }
    }
}

fn parse_header_hints(headers: &HeaderMap, origin: &Url) -> Vec<Url> {
    let mut urls = Vec::new();
    urls.extend(parse_link_headers(headers, origin));
    urls.extend(extract_hint_headers(headers, origin));
    dedupe_urls(urls)
}

fn parse_link_headers(headers: &HeaderMap, origin: &Url) -> Vec<Url> {
    let mut urls = Vec::new();
    for value in headers.get_all(LINK).iter() {
        if let Ok(raw) = value.to_str() {
            for segment in split_link_entries(raw) {
                if let Some(url) = parse_link_entry(&segment, origin) {
                    urls.push(url);
                }
            }
        }
    }
    urls
}

fn parse_link_entry(entry: &str, origin: &Url) -> Option<Url> {
    let mut parts = entry.split(';');
    let target = parts.next()?.trim();
    if !target.starts_with('<') || !target.ends_with('>') {
        return None;
    }

    let href = &target[1..target.len() - 1];
    let mut rels = Vec::new();
    let mut mime = None;

    for part in parts {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut kv = trimmed.splitn(2, '=');
        let key = kv.next()?.trim().to_ascii_lowercase();
        let value = kv.next()?.trim().trim_matches('"').to_ascii_lowercase();
        match key.as_str() {
            "rel" => {
                rels = value
                    .split_whitespace()
                    .map(|segment| segment.to_string())
                    .collect();
            }
            "type" => {
                mime = Some(value);
            }
            _ => {}
        }
    }

    if !is_structured_link(&rels, mime.as_deref()) {
        return None;
    }

    resolve_url(origin, href)
}

fn is_structured_link(rels: &[String], mime: Option<&str>) -> bool {
    let rel_match = rels.iter().any(|rel| {
        matches!(
            rel.as_str(),
            "service-desc"
                | "service-doc"
                | "openapi"
                | "graphql"
                | "https://spec.openapis.org/oas/3.0/rel/definition"
                | "https://spec.openapis.org/oas/3.1/rel/definition"
        )
    });

    if rel_match {
        return true;
    }

    if rels.iter().any(|rel| rel == "alternate")
        && mime.is_some_and(|value| {
            value.contains("openapi")
                || value.contains("json")
                || value.contains("yaml")
                || value.contains("graphql")
        })
    {
        return true;
    }

    mime.is_some_and(|value| value.contains("openapi") || value.contains("graphql"))
}

fn extract_hint_headers(headers: &HeaderMap, origin: &Url) -> Vec<Url> {
    let mut collected = Vec::new();
    for (name, value) in headers.iter() {
        if let Some(hint) = header_hint_for(name.as_str())
            && let Some(url) = parse_header_value(origin, value)
        {
            debug!(header = %name, url = %url, "discovery header hint {hint}");
            collected.push(url);
        }
    }
    collected
}

fn header_hint_for(name: &str) -> Option<&'static str> {
    let lower = name.to_ascii_lowercase();
    if HEADER_HINT_OPENAPI.contains(&lower.as_str()) {
        Some("openapi")
    } else if HEADER_HINT_GRAPHQL.contains(&lower.as_str()) {
        Some("graphql")
    } else {
        None
    }
}

fn parse_header_value(origin: &Url, value: &HeaderValue) -> Option<Url> {
    let raw = value.to_str().ok()?;
    resolve_url(origin, raw.trim())
}

fn resolve_url(origin: &Url, raw: &str) -> Option<Url> {
    Url::parse(raw).ok().or_else(|| origin.join(raw).ok())
}

fn dedupe_urls(urls: Vec<Url>) -> Vec<Url> {
    let mut seen = HashSet::new();
    let mut deduped = Vec::new();
    for url in urls {
        let key = url.to_string();
        if seen.insert(key.clone()) {
            deduped.push(url);
        }
    }
    deduped
}

fn split_link_entries(value: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in value.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                current.push(ch);
            }
            ',' if !in_quotes => {
                if !current.trim().is_empty() {
                    parts.push(current.trim().to_string());
                }
                current.clear();
            }
            _ => current.push(ch),
        }
    }

    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }

    parts
}

#[derive(Debug, Deserialize)]
struct AiPluginDocument {
    api: Option<AiPluginApi>,
}

#[derive(Debug, Deserialize)]
struct AiPluginApi {
    url: Option<String>,
}

const HEADER_HINT_OPENAPI: &[&str] = &[
    "x-openapi-endpoint",
    "x-openapi-spec",
    "x-openapi-url",
    "x-openapi-schema",
    "openapi-endpoint",
    "openapi-url",
];

const HEADER_HINT_GRAPHQL: &[&str] = &[
    "x-graphql-endpoint",
    "x-graphql-url",
    "graphql-endpoint",
    "graphql-url",
    "apollo-graphql-url",
];

#[cfg(test)]
mod tests {
    use super::*;
    use httpmock::{Method, prelude::*};
    use reqwest::Client;

    fn block_on_future<F: Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap_or_else(|err| panic!("build tokio runtime: {err}"))
            .block_on(future)
    }

    #[test]
    fn probe_respects_total_timeout_budget() {
        let server = MockServer::start();
        let _openapi = server.mock(|when, then| {
            when.method(Method::GET).path("/.well-known/openapi.json");
            then.status(404);
        });
        let _ai_plugin = server.mock(|when, then| {
            when.method(Method::GET).path("/.well-known/ai-plugin.json");
            then.status(404);
        });
        let _head = server.mock(|when, then| {
            when.method(Method::HEAD).path("/");
            then.status(200).delay(Duration::from_millis(500));
        });

        let client = Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap_or_else(|err| panic!("build probe client: {err}"));

        let origin =
            Url::parse(&server.base_url()).unwrap_or_else(|err| panic!("parse origin url: {err}"));
        let timeout = Duration::from_millis(150);

        let result = block_on_future(async {
            tokio::time::timeout(
                Duration::from_millis(220),
                probe_structured_origin(&client, &origin, timeout),
            )
            .await
        })
        .unwrap_or_else(|_| panic!("probe exceeded total timeout budget"));

        assert!(matches!(result.outcome, ProbeOutcome::Timeout));
    }
}
