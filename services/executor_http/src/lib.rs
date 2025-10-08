//! Generic HTTP executor scaffolding for Tyrum.

use std::{env, time::Duration};

use once_cell::sync::OnceCell;
use reqwest::{
    Client, Method,
    header::{CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue},
    redirect,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tracing::{info, warn};
use tyrum_shared::planner::{ActionArguments, ActionPrimitive, ActionPrimitiveKind};
use url::Url;

pub mod telemetry;

const USER_AGENT: &str = "tyrum-http-executor/0.1";
const REQUEST_TIMEOUT_SECS: u64 = 15;
const POOL_IDLE_TIMEOUT_SECS: u64 = 30;
const ALLOWED_HOSTS_ENV: &str = "HTTP_EXECUTOR_ALLOWED_HOSTS";
const DEFAULT_ALLOWED_HOSTS: &[&str] = &["localhost", "127.0.0.1", "::1"];
// TODO: add per-host rate limiting once outbound allowlists include remote APIs.

static HTTP_CLIENT: OnceCell<Client> = OnceCell::new();
static HOST_ALLOWLIST: OnceCell<Vec<String>> = OnceCell::new();

/// Common result type exposed by the HTTP executor.
pub type Result<T> = std::result::Result<T, HttpExecutorError>;

/// Deterministic outcome returned to the planner on success.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HttpActionOutcome {
    /// HTTP status code reported by the upstream service.
    pub status: u16,
    /// Sanitised response headers sorted alphabetically.
    pub headers: Vec<HttpHeader>,
    /// Parsed JSON payload returned by the upstream service.
    pub body: Value,
}

/// Sandbox constraints surfaced via the HTTP executor HTTP API.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SandboxSummary {
    /// Hosts the executor may contact without escalation.
    pub allowed_hosts: Vec<String>,
}

/// Return the current sandbox configuration for diagnostics.
pub fn sandbox_summary() -> SandboxSummary {
    SandboxSummary {
        allowed_hosts: HOST_ALLOWLIST.get_or_init(load_allowed_hosts).clone(),
    }
}

/// Header pair surfaced to callers with sensitive values scrubbed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HttpHeader {
    /// Lowercase header name.
    pub name: String,
    /// Header value with sensitive fields redacted.
    pub value: String,
}

/// Errors returned by the HTTP executor.
#[derive(Debug, Error)]
pub enum HttpExecutorError {
    /// Planner requested a primitive that this executor cannot satisfy.
    #[error("unsupported primitive kind {0:?}")]
    UnsupportedPrimitive(ActionPrimitiveKind),
    /// Planner omitted a required argument.
    #[error("missing required argument '{0}'")]
    MissingArgument(&'static str),
    /// Planner provided an argument of the wrong type.
    #[error("invalid argument '{argument}': {reason}")]
    InvalidArgumentValue {
        /// Argument name reported in the error.
        argument: &'static str,
        /// Human readable summary of the failure.
        reason: &'static str,
    },
    /// Planner supplied an invalid HTTP method.
    #[error("invalid http method: {0}")]
    InvalidMethod(String),
    /// Planner supplied an invalid URL.
    #[error("invalid url '{value}': {source}")]
    InvalidUrl {
        /// Parsing error from the `url` crate.
        #[source]
        source: url::ParseError,
        /// Original value.
        value: String,
    },
    /// Planner supplied a header name that failed validation.
    #[error("invalid header name '{name}': {source}")]
    InvalidHeaderName {
        /// Header name that failed validation.
        name: String,
        /// Source error from `http` crate.
        #[source]
        source: reqwest::header::InvalidHeaderName,
    },
    /// Planner supplied a header value that failed validation.
    #[error("invalid header value for '{name}': {source}")]
    InvalidHeaderValue {
        /// Header name owning the invalid value.
        name: String,
        /// Source error from `http` crate.
        #[source]
        source: reqwest::header::InvalidHeaderValue,
    },
    /// Planner attempted to reach a host outside the allowed list.
    #[error("disallowed host '{host}'")]
    DisallowedHost {
        /// Host extracted from the request URL.
        host: String,
    },
    /// Upstream request encountered a transport or protocol failure.
    #[error("request failed: {0}")]
    Request(#[from] reqwest::Error),
    /// Upstream response body failed to deserialize as JSON.
    #[error("response body was not valid JSON: {0}")]
    ResponseJson(#[from] serde_json::Error),
    /// Supplied JSON schema could not be compiled.
    #[error("invalid json schema: {0}")]
    InvalidSchema(String),
    /// Response JSON failed schema validation.
    #[error("response failed schema validation: {0}")]
    SchemaValidationFailed(String),
    /// Upstream responded with an unsuccessful status code.
    #[error("http request returned status {status}")]
    HttpFailure {
        /// HTTP status code returned by the upstream.
        status: u16,
        /// Sanitised response headers surfaced for troubleshooting.
        headers: Vec<HttpHeader>,
        /// JSON body returned by the upstream.
        body: Value,
    },
}

/// Executes the HTTP primitive and returns the validated JSON payload.
pub async fn execute_http_action(action: &ActionPrimitive) -> Result<HttpActionOutcome> {
    ensure_http_primitive(action)?;

    let method = parse_method(&action.args)?;
    let url = parse_url(&action.args)?;
    enforce_allowlist(&url)?;
    let header_entries = parse_headers(&action.args)?;
    let body = extract_body(&action.args);
    let schema = extract_schema(&action.args);

    let context = telemetry::AttemptContext::new(&method, &url);
    let request_headers_for_logging = sanitise_header_pairs(&header_entries);
    let header_map = build_header_map(&header_entries, body.as_ref());

    let client = http_client().clone();
    let method_for_request = method.clone();
    let url_for_request = url.clone();
    let body_for_request = body.clone();
    let schema_for_request = schema.clone();

    let (result, elapsed) = telemetry::record_attempt(&context, async move {
        perform_http_request(
            client,
            method_for_request,
            url_for_request,
            header_map,
            body_for_request,
            schema_for_request,
        )
        .await
    })
    .await;

    match result {
        Ok(outcome) => {
            log_http_success(
                &method,
                &url,
                elapsed,
                &request_headers_for_logging,
                &outcome,
            );
            Ok(outcome)
        }
        Err(err) => {
            log_http_failure(&method, &url, elapsed, &request_headers_for_logging, &err);
            Err(err)
        }
    }
}

async fn perform_http_request(
    client: Client,
    method: Method,
    url: Url,
    headers: HeaderMap,
    body: Option<Value>,
    schema: Option<Value>,
) -> Result<HttpActionOutcome> {
    let mut request = client.request(method, url);
    request = request.headers(headers);

    if let Some(payload) = body.as_ref() {
        request = request.json(payload);
    }

    let response = request.send().await?;
    let status = response.status();
    let headers = sanitise_header_map(response.headers());
    let body_json: Value = response.json().await?;

    if !status.is_success() {
        return Err(HttpExecutorError::HttpFailure {
            status: status.as_u16(),
            headers,
            body: body_json,
        });
    }

    if let Some(schema) = schema.as_ref() {
        validate_schema(schema, &body_json)?;
    }

    Ok(HttpActionOutcome {
        status: status.as_u16(),
        headers,
        body: body_json,
    })
}

fn log_http_success(
    method: &Method,
    url: &Url,
    duration: Duration,
    request_headers: &[(String, String)],
    outcome: &HttpActionOutcome,
) {
    info!(
        method = %method,
        url = %url,
        status = outcome.status,
        duration_ms = duration.as_millis(),
        request_headers = ?request_headers,
        response_headers = ?outcome.headers,
        "http executor request completed"
    );
}

fn log_http_failure(
    method: &Method,
    url: &Url,
    duration: Duration,
    request_headers: &[(String, String)],
    err: &HttpExecutorError,
) {
    let response_headers = match err {
        HttpExecutorError::HttpFailure { headers, .. } => Some(headers),
        _ => None,
    };

    info!(
        method = %method,
        url = %url,
        duration_ms = duration.as_millis(),
        request_headers = ?request_headers,
        response_headers = ?response_headers,
        error = %err,
        "http executor request failed"
    );
}

fn ensure_http_primitive(action: &ActionPrimitive) -> Result<()> {
    if action.kind != ActionPrimitiveKind::Http {
        return Err(HttpExecutorError::UnsupportedPrimitive(action.kind));
    }
    Ok(())
}

fn parse_method(args: &ActionArguments) -> Result<Method> {
    let method = require_string(args, "method")?;
    let canonical = method.to_ascii_uppercase();
    match canonical.as_str() {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        "PATCH" => Ok(Method::PATCH),
        "DELETE" => Ok(Method::DELETE),
        "HEAD" => Ok(Method::HEAD),
        "OPTIONS" => Ok(Method::OPTIONS),
        _ => Err(HttpExecutorError::InvalidMethod(method)),
    }
}

fn parse_url(args: &ActionArguments) -> Result<Url> {
    let value = require_string(args, "url")?;
    Url::parse(&value).map_err(|source| HttpExecutorError::InvalidUrl { source, value })
}

fn parse_headers(args: &ActionArguments) -> Result<Vec<(HeaderName, HeaderValue)>> {
    let Some(raw) = args.get("headers") else {
        return Ok(Vec::new());
    };

    match raw {
        Value::Null => Ok(Vec::new()),
        Value::Object(map) => {
            let mut entries = Vec::with_capacity(map.len());
            for (name, value) in map {
                let header_name = HeaderName::try_from(name.as_str()).map_err(|source| {
                    HttpExecutorError::InvalidHeaderName {
                        name: name.clone(),
                        source,
                    }
                })?;
                let Value::String(text) = value else {
                    return Err(HttpExecutorError::InvalidArgumentValue {
                        argument: "headers",
                        reason: "header values must be strings",
                    });
                };
                let header_value = HeaderValue::try_from(text.as_str()).map_err(|source| {
                    HttpExecutorError::InvalidHeaderValue {
                        name: name.clone(),
                        source,
                    }
                })?;
                entries.push((header_name, header_value));
            }
            Ok(entries)
        }
        _ => Err(HttpExecutorError::InvalidArgumentValue {
            argument: "headers",
            reason: "expected object mapping header names to string values",
        }),
    }
}

fn extract_body(args: &ActionArguments) -> Option<Value> {
    args.get("body")
        .and_then(|value| (!value.is_null()).then(|| value.clone()))
}

fn extract_schema(args: &ActionArguments) -> Option<Value> {
    args.get("response_schema")
        .and_then(|value| (!value.is_null()).then(|| value.clone()))
}

fn http_client() -> &'static Client {
    HTTP_CLIENT.get_or_init(build_http_client)
}

fn build_http_client() -> Client {
    let builder = Client::builder()
        .user_agent(USER_AGENT)
        .pool_idle_timeout(Duration::from_secs(POOL_IDLE_TIMEOUT_SECS))
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .redirect(redirect::Policy::custom(|attempt| {
            if attempt
                .url()
                .host_str()
                .is_some_and(host_allowed)
            {
                attempt.follow()
            } else {
                warn!(target: "tyrum::executor_http", redirect = %attempt.url(), "blocked redirect to disallowed host");
                attempt.stop()
            }
        }));

    match builder.build() {
        Ok(client) => client,
        Err(err) => panic!("failed to build http client: {err}"),
    }
}

fn build_header_map(entries: &[(HeaderName, HeaderValue)], body: Option<&Value>) -> HeaderMap {
    let mut map = HeaderMap::new();
    for (name, value) in entries {
        map.append(name.clone(), value.clone());
    }
    if body.is_some() && !map.contains_key(CONTENT_TYPE) {
        map.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    }
    map
}

fn enforce_allowlist(url: &Url) -> Result<()> {
    let host = url
        .host_str()
        .ok_or_else(|| HttpExecutorError::InvalidUrl {
            source: url::ParseError::EmptyHost,
            value: url.to_string(),
        })?;

    if host_allowed(host) {
        Ok(())
    } else {
        Err(HttpExecutorError::DisallowedHost {
            host: host.to_string(),
        })
    }
}

fn allowed_hosts() -> &'static Vec<String> {
    HOST_ALLOWLIST.get_or_init(load_allowed_hosts)
}

fn host_allowed(host: &str) -> bool {
    allowed_hosts()
        .iter()
        .any(|candidate| candidate.eq_ignore_ascii_case(host))
}

fn load_allowed_hosts() -> Vec<String> {
    match env::var(ALLOWED_HOSTS_ENV) {
        Ok(value) => value
            .split(',')
            .map(|item| item.trim())
            .filter(|item| !item.is_empty())
            .map(|item| item.to_string())
            .collect(),
        Err(_) => DEFAULT_ALLOWED_HOSTS
            .iter()
            .map(|host| host.to_string())
            .collect(),
    }
}

fn sanitise_header_pairs(entries: &[(HeaderName, HeaderValue)]) -> Vec<(String, String)> {
    let mut sanitised = entries
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_lowercase(),
                sanitise_header_value(name.as_str(), value),
            )
        })
        .collect::<Vec<_>>();
    sanitised.sort_by(|a, b| a.0.cmp(&b.0));
    sanitised
}

fn sanitise_header_map(headers: &HeaderMap) -> Vec<HttpHeader> {
    let mut pairs = headers
        .iter()
        .map(|(name, value)| HttpHeader {
            name: name.as_str().to_lowercase(),
            value: sanitise_header_value(name.as_str(), value),
        })
        .collect::<Vec<_>>();
    pairs.sort_by(|a, b| a.name.cmp(&b.name));
    pairs
}

fn sanitise_header_value(name: &str, value: &HeaderValue) -> String {
    if name.eq_ignore_ascii_case("authorization") {
        return "REDACTED".to_string();
    }

    match value.to_str() {
        Ok(text) => text.to_string(),
        Err(_) => "<binary>".to_string(),
    }
}

fn validate_schema(schema: &Value, body: &Value) -> Result<()> {
    let validator = jsonschema::validator_for(schema)
        .map_err(|err| HttpExecutorError::InvalidSchema(err.to_string()))?;

    let mut errors = validator.iter_errors(body);
    if let Some(first) = errors.next() {
        let mut messages = vec![first.to_string()];
        messages.extend(errors.map(|error| error.to_string()));
        let joined = messages.join("; ");
        return Err(HttpExecutorError::SchemaValidationFailed(joined));
    }

    Ok(())
}

fn require_string(args: &ActionArguments, key: &'static str) -> Result<String> {
    match args.get(key) {
        Some(Value::String(value)) => Ok(value.clone()),
        Some(_) => Err(HttpExecutorError::InvalidArgumentValue {
            argument: key,
            reason: "expected string",
        }),
        None => Err(HttpExecutorError::MissingArgument(key)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn primitive_with_args(args: Value) -> ActionPrimitive {
        let map = match args.as_object() {
            Some(object) => object.clone(),
            None => panic!("http primitive args must be an object"),
        };
        ActionPrimitive::new(ActionPrimitiveKind::Http, map)
    }

    #[test]
    fn sanitise_header_pairs_redacts_authorization() {
        let entries = vec![
            (
                HeaderName::from_static("authorization"),
                HeaderValue::from_static("Bearer token"),
            ),
            (
                HeaderName::from_static("x-request-id"),
                HeaderValue::from_static("abc"),
            ),
        ];
        let sanitised = sanitise_header_pairs(&entries);
        assert_eq!(sanitised[0].1, "REDACTED");
        assert_eq!(sanitised[1].1, "abc");
    }

    #[test]
    fn allowed_hosts_default_to_local() {
        let hosts = allowed_hosts();
        assert!(hosts.iter().any(|host| host == "localhost"));
    }

    #[test]
    fn parse_method_rejects_invalid() {
        let primitive = primitive_with_args(json!({
            "method": "INVALID",
            "url": "http://localhost:8080"
        }));
        let err = match parse_method(&primitive.args) {
            Err(err) => err,
            Ok(_) => panic!("expected invalid method error"),
        };
        assert!(matches!(err, HttpExecutorError::InvalidMethod(method) if method == "INVALID"));
    }
}
