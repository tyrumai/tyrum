use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, anyhow, bail};
use axum::{
    Error as AxumError, Router,
    body::Body,
    extract::{OriginalUri, State},
    http::{Request, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
};
use bytes::Bytes;
use futures_util::StreamExt;
use http_body_util::BodyExt;
use reqwest::header::{HeaderMap as ReqwestHeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use tokio::net::TcpListener;
use tower::ServiceBuilder;
use tower_http::trace::TraceLayer;
use tracing::{error, info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing()?;

    let bind_addr =
        env::var("MODEL_GATEWAY_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8001".to_string());
    let config_path = env::var("MODEL_GATEWAY_CONFIG")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("config/model_gateway.yml"));

    let settings = GatewaySettings::load(&config_path)?;
    let app_state = AppState::try_from(settings)?;

    let app = Router::new()
        .route("/healthz", get(health))
        .route("/v1/completions", post(proxy))
        .route("/v1/chat/completions", post(proxy))
        .route("/v1/audio/speech", post(proxy))
        .route("/v1/embeddings", post(proxy))
        .with_state(app_state)
        .layer(ServiceBuilder::new().layer(TraceLayer::new_for_http()));

    let listener = TcpListener::bind(&bind_addr)
        .await
        .with_context(|| format!("binding model gateway on {bind_addr}"))?;
    info!("model gateway listening on {bind_addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

fn init_tracing() -> anyhow::Result<()> {
    let env_filter = env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(env_filter))
        .with(tracing_subscriber::fmt::layer())
        .try_init()
        .with_context(|| "initializing tracing subscriber")?;
    Ok(())
}

#[derive(Clone)]
struct AppState {
    routes: Arc<HashMap<String, ModelRoute>>,
    defaults: Defaults,
    client: reqwest::Client,
}

impl TryFrom<GatewaySettings> for AppState {
    type Error = anyhow::Error;

    fn try_from(settings: GatewaySettings) -> Result<Self, Self::Error> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(settings.defaults.timeout_ms))
            .build()
            .context("building HTTP client")?;
        Ok(Self {
            routes: Arc::new(settings.routes),
            defaults: settings.defaults,
            client,
        })
    }
}
#[derive(Debug, Clone)]
struct ModelRoute {
    target: String,
    base_url: String,
    auth: ResolvedAuth,
    capabilities: Vec<String>,
    max_total_tokens: Option<u32>,
    cost_ceiling_usd: Option<f32>,
}

#[derive(Debug, Clone)]
enum ResolvedAuth {
    None,
    Bearer(HeaderValue),
    Static {
        header: HeaderName,
        value: HeaderValue,
    },
}

impl ResolvedAuth {
    fn apply(&self, headers: &mut ReqwestHeaderMap) {
        match self {
            ResolvedAuth::None => {}
            ResolvedAuth::Bearer(value) => {
                headers.insert(reqwest::header::AUTHORIZATION, value.clone());
            }
            ResolvedAuth::Static { header, value } => {
                headers.insert(header.clone(), value.clone());
            }
        }
    }
}

#[derive(Debug, Clone)]
struct Defaults {
    timeout_ms: u64,
}

impl Defaults {
    const DEFAULT_TIMEOUT_MS: u64 = 20_000;
}

#[derive(Debug)]
struct GatewaySettings {
    defaults: Defaults,
    routes: HashMap<String, ModelRoute>,
}

impl GatewaySettings {
    fn load(path: &Path) -> anyhow::Result<Self> {
        let contents = fs::read_to_string(path)
            .with_context(|| format!("reading model gateway config at {}", path.display()))?;
        if contents.trim().is_empty() {
            bail!(
                "model gateway config at {} is empty; define at least one model route",
                path.display()
            );
        }
        let config: GatewayConfig = serde_yaml::from_str(&contents)
            .with_context(|| format!("parsing model gateway config at {}", path.display()))?;

        let defaults = Defaults {
            timeout_ms: config
                .defaults
                .and_then(|d| d.timeout_ms)
                .unwrap_or(Defaults::DEFAULT_TIMEOUT_MS),
        };

        let mut resolved_profiles = HashMap::with_capacity(config.auth_profiles.len());
        for (key, profile) in config.auth_profiles {
            let resolved = ResolvedAuth::try_from(profile)
                .with_context(|| format!("resolving auth profile '{key}'"))?;
            resolved_profiles.insert(key, resolved);
        }

        let mut routes = HashMap::with_capacity(config.models.len());
        for (model_name, cfg) in config.models {
            let base_url = sanitize_base_url(&cfg.endpoint)
                .with_context(|| format!("parsing endpoint for model '{model_name}'"))?;
            let auth = cfg
                .auth_profile
                .as_ref()
                .and_then(|name| resolved_profiles.get(name))
                .cloned()
                .unwrap_or(ResolvedAuth::None);

            let route = ModelRoute {
                target: cfg.target,
                base_url,
                auth,
                capabilities: cfg.capabilities.unwrap_or_default(),
                max_total_tokens: cfg.max_total_tokens,
                cost_ceiling_usd: cfg.cost_ceiling_usd,
            };
            routes.insert(model_name, route);
        }

        if routes.is_empty() {
            bail!(
                "model gateway config at {} defines no models; at least one is required",
                path.display()
            );
        }

        Ok(Self { defaults, routes })
    }
}

fn sanitize_base_url(raw: &str) -> anyhow::Result<String> {
    let url = reqwest::Url::parse(raw).with_context(|| format!("invalid endpoint URL '{raw}'"))?;
    let mut cleaned = url.clone();
    cleaned.set_query(None);
    cleaned.set_fragment(None);
    Ok(cleaned.to_string())
}

#[derive(Default, Deserialize)]
struct GatewayConfig {
    defaults: Option<DefaultsConfig>,
    #[serde(default)]
    auth_profiles: HashMap<String, AuthProfileConfig>,
    #[serde(default)]
    models: HashMap<String, ModelConfig>,
}

#[derive(Deserialize)]
struct DefaultsConfig {
    timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
enum AuthProfileConfig {
    #[serde(alias = "none")]
    None,
    Bearer {
        env: String,
    },
    StaticHeader {
        header: String,
        value: String,
    },
}

impl TryFrom<AuthProfileConfig> for ResolvedAuth {
    type Error = anyhow::Error;

    fn try_from(value: AuthProfileConfig) -> Result<Self, Self::Error> {
        match value {
            AuthProfileConfig::None => Ok(ResolvedAuth::None),
            AuthProfileConfig::Bearer { env } => {
                let token = env::var(&env).with_context(|| {
                    format!("missing environment variable '{env}' for bearer auth")
                })?;
                let trimmed = token.trim();
                if trimmed.is_empty() {
                    bail!("environment variable '{env}' for bearer auth is empty");
                }
                if trimmed.contains('\n') || trimmed.contains('\r') {
                    bail!(
                        "environment variable '{env}' contains invalid characters for bearer auth"
                    );
                }
                let header_val = HeaderValue::from_str(trimmed)
                    .with_context(|| format!("invalid bearer header value from env '{env}'"))?;
                Ok(ResolvedAuth::Bearer(header_val))
            }
            AuthProfileConfig::StaticHeader { header, value } => {
                let header_name = HeaderName::from_bytes(header.as_bytes())
                    .with_context(|| format!("invalid header name '{header}'"))?;
                let header_val = HeaderValue::from_str(&value)
                    .with_context(|| format!("invalid header value for '{header}'"))?;
                Ok(ResolvedAuth::Static {
                    header: header_name,
                    value: header_val,
                })
            }
        }
    }
}

#[derive(Deserialize)]
struct ModelConfig {
    target: String,
    endpoint: String,
    #[serde(default)]
    auth_profile: Option<String>,
    #[serde(default)]
    capabilities: Option<Vec<String>>,
    #[serde(default)]
    max_total_tokens: Option<u32>,
    #[serde(default)]
    cost_ceiling_usd: Option<f32>,
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let models = state
        .routes
        .iter()
        .map(|(name, route)| HealthModel {
            model: name.clone(),
            target: route.target.clone(),
            endpoint: route.base_url.clone(),
            capabilities: route.capabilities.clone(),
            max_total_tokens: route.max_total_tokens,
            cost_ceiling_usd: route.cost_ceiling_usd,
        })
        .collect();
    Json(HealthResponse {
        status: "ok",
        timeout_ms: state.defaults.timeout_ms,
        models,
    })
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    timeout_ms: u64,
    models: Vec<HealthModel>,
}

#[derive(Serialize)]
struct HealthModel {
    model: String,
    target: String,
    endpoint: String,
    capabilities: Vec<String>,
    max_total_tokens: Option<u32>,
    cost_ceiling_usd: Option<f32>,
}

async fn proxy(
    State(state): State<AppState>,
    original_uri: OriginalUri,
    req: Request<Body>,
) -> Result<Response, GatewayError> {
    let (parts, body) = req.into_parts();
    let method = validate_method(&parts)?;
    let body_bytes = read_body(body).await?;
    let details = resolve_request(&state, &body_bytes)?;
    let upstream_url = build_forward_url(&details.route.base_url, &original_uri)?;
    let headers = build_forward_headers(&parts, details.route);
    let upstream_response = forward_request(
        &state,
        method,
        upstream_url,
        headers,
        body_bytes,
        &details.model,
    )
    .await?;

    if should_stream(&details, &upstream_response) {
        build_streaming_response(upstream_response).await
    } else {
        build_buffered_response(upstream_response).await
    }
}

fn validate_method(parts: &axum::http::request::Parts) -> Result<reqwest::Method, GatewayError> {
    if parts.method != axum::http::Method::POST {
        return Err(GatewayError::method_not_allowed(parts.method.clone()));
    }
    reqwest::Method::from_bytes(parts.method.as_str().as_bytes())
        .map_err(|err| GatewayError::internal("converting HTTP method", err))
}

async fn read_body(body: Body) -> Result<Bytes, GatewayError> {
    body.collect()
        .await
        .map_err(|err| GatewayError::internal("reading request body", err))
        .map(|collected| collected.to_bytes())
}

struct RequestDetails<'route> {
    route: &'route ModelRoute,
    model: String,
    stream: bool,
}

fn resolve_request<'route>(
    state: &'route AppState,
    body_bytes: &[u8],
) -> Result<RequestDetails<'route>, GatewayError> {
    let RequestBody { model, stream } = extract_request_details(body_bytes)?;
    let route = state
        .routes
        .get(model.as_str())
        .ok_or_else(|| GatewayError::unknown_model(model.clone()))?;
    Ok(RequestDetails {
        route,
        model,
        stream,
    })
}

const HOP_BY_HOP_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

fn default_hop_by_hop_set() -> HashSet<HeaderName> {
    let mut headers = HashSet::with_capacity(HOP_BY_HOP_HEADERS.len());
    for name in HOP_BY_HOP_HEADERS {
        headers.insert(HeaderName::from_static(name));
    }
    headers
}

fn extend_with_connection_tokens(set: &mut HashSet<HeaderName>, header: Option<&HeaderValue>) {
    let Some(value) = header else {
        return;
    };
    let tokens = match value.to_str() {
        Ok(tokens) => tokens,
        Err(err) => {
            warn!("ignoring connection header with non-UTF8 value: {err}");
            return;
        }
    };
    for token in tokens.split(',') {
        handle_connection_token(set, token);
    }
}

fn handle_connection_token(set: &mut HashSet<HeaderName>, token: &str) {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return;
    }
    match HeaderName::from_bytes(trimmed.as_bytes()) {
        Ok(name) => {
            set.insert(name);
        }
        Err(err) => warn!("ignoring invalid hop-by-hop header token '{trimmed}': {err}"),
    }
}

fn request_skip_headers(headers: &axum::http::HeaderMap) -> HashSet<HeaderName> {
    let mut skip = default_hop_by_hop_set();
    skip.insert(axum::http::header::HOST.clone());
    skip.insert(axum::http::header::CONTENT_LENGTH.clone());
    skip.insert(axum::http::header::AUTHORIZATION.clone());
    extend_with_connection_tokens(&mut skip, headers.get(axum::http::header::CONNECTION));
    skip
}

fn response_skip_headers(headers: &ReqwestHeaderMap) -> HashSet<HeaderName> {
    let mut skip = default_hop_by_hop_set();
    skip.insert(reqwest::header::CONTENT_LENGTH.clone());
    extend_with_connection_tokens(&mut skip, headers.get(reqwest::header::CONNECTION));
    skip
}

fn build_forward_headers(
    parts: &axum::http::request::Parts,
    route: &ModelRoute,
) -> ReqwestHeaderMap {
    let mut headers = ReqwestHeaderMap::new();
    let skip = request_skip_headers(&parts.headers);
    for (name, value) in parts.headers.iter() {
        if skip.contains(name) {
            continue;
        }
        headers.insert(name.clone(), value.clone());
    }
    route.auth.apply(&mut headers);
    headers
}

fn build_forward_url(base: &str, original_uri: &OriginalUri) -> Result<reqwest::Url, GatewayError> {
    build_upstream_url(base, original_uri.path(), original_uri.query())
        .map_err(|err| GatewayError::internal("constructing upstream URL", err))
}

async fn forward_request(
    state: &AppState,
    method: reqwest::Method,
    upstream_url: reqwest::Url,
    headers: ReqwestHeaderMap,
    body_bytes: Bytes,
    model: &str,
) -> Result<reqwest::Response, GatewayError> {
    state
        .client
        .request(method, upstream_url)
        .headers(headers)
        .body(body_bytes)
        .send()
        .await
        .map_err(|err| GatewayError::upstream_failure(model.to_string(), err))
}

fn should_stream(details: &RequestDetails<'_>, upstream: &reqwest::Response) -> bool {
    details.stream
        || upstream
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.starts_with("text/event-stream"))
            .unwrap_or(false)
}

async fn build_buffered_response(
    upstream_response: reqwest::Response,
) -> Result<Response, GatewayError> {
    let status = upstream_response.status();
    let upstream_headers = upstream_response.headers().clone();
    let bytes = upstream_response
        .bytes()
        .await
        .map_err(|err| GatewayError::internal("reading upstream response", err))?;

    let mut response_builder = Response::builder().status(status);
    if let Some(headers_mut) = response_builder.headers_mut() {
        let skip = response_skip_headers(&upstream_headers);
        for (name, value) in upstream_headers.iter() {
            if skip.contains(name) {
                continue;
            }
            headers_mut.insert(name.clone(), value.clone());
        }
    } else {
        warn!("unable to mutate response headers; upstream headers dropped");
    }

    response_builder
        .body(Body::from(bytes))
        .map_err(|err| GatewayError::internal("building response", err))
}

async fn build_streaming_response(
    upstream_response: reqwest::Response,
) -> Result<Response, GatewayError> {
    let status = upstream_response.status();
    let upstream_headers = upstream_response.headers().clone();

    let mut response_builder = Response::builder().status(status);
    if let Some(headers_mut) = response_builder.headers_mut() {
        let skip = response_skip_headers(&upstream_headers);
        for (name, value) in upstream_headers.iter() {
            if skip.contains(name) {
                continue;
            }
            headers_mut.insert(name.clone(), value.clone());
        }
    } else {
        warn!("unable to mutate response headers; upstream headers dropped");
    }

    let stream = upstream_response.bytes_stream().map(|chunk| {
        chunk.map_err(|err| {
            error!("streaming error from upstream: {err}");
            AxumError::new(err)
        })
    });

    response_builder
        .body(Body::from_stream(stream))
        .map_err(|err| GatewayError::internal("building streaming response", err))
}

fn build_upstream_url(
    base: &str,
    path: &str,
    query: Option<&str>,
) -> Result<reqwest::Url, url::ParseError> {
    let trimmed = base.trim_end_matches('/');
    let mut url =
        String::with_capacity(trimmed.len() + path.len() + query.map_or(0, |q| q.len() + 1));
    url.push_str(trimmed);
    url.push_str(path);
    if let Some(q) = query.filter(|q| !q.is_empty()) {
        url.push('?');
        url.push_str(q);
    }
    reqwest::Url::parse(&url)
}

struct RequestBody {
    model: String,
    stream: bool,
}

fn extract_request_details(body: &[u8]) -> Result<RequestBody, GatewayError> {
    let value: Value = serde_json::from_slice(body)
        .map_err(|err| GatewayError::invalid_request("invalid JSON payload", err))?;
    let model = value.get("model").and_then(|m| m.as_str()).ok_or_else(|| {
        let context = if let Some(object) = value.as_object() {
            if object.is_empty() {
                "present top-level keys: <none>".to_string()
            } else {
                let list = object
                    .keys()
                    .map(|k| k.as_str())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("present top-level keys: {list}")
            }
        } else {
            format!("body type: {}", describe_value_type(&value))
        };

        GatewayError::invalid_request("request body missing 'model' field", anyhow!(context))
    })?;
    let stream = value
        .get("stream")
        .and_then(|flag| flag.as_bool())
        .unwrap_or(false);
    Ok(RequestBody {
        model: model.to_string(),
        stream,
    })
}

fn describe_value_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

#[derive(Error, Debug)]
enum GatewayError {
    #[error("{context}")]
    InvalidRequest { status: StatusCode, context: String },
    #[error("model '{model}' is not configured for this gateway")]
    UnknownModel { model: String },
    #[error("failed to reach upstream for model '{model}': {source}")]
    UpstreamFailure {
        model: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("{context}: {source}")]
    Internal {
        context: String,
        #[source]
        source: anyhow::Error,
    },
    #[error("request method {method} not allowed")]
    MethodNotAllowed { method: axum::http::Method },
}

impl GatewayError {
    fn invalid_request(context: &str, source: impl Into<anyhow::Error>) -> Self {
        let err = source.into();
        GatewayError::InvalidRequest {
            status: StatusCode::BAD_REQUEST,
            context: format!("{context}: {err}"),
        }
    }

    fn unknown_model(model: String) -> Self {
        GatewayError::UnknownModel { model }
    }

    fn upstream_failure(model: String, source: reqwest::Error) -> Self {
        GatewayError::UpstreamFailure { model, source }
    }

    fn internal(context: &str, source: impl Into<anyhow::Error>) -> Self {
        GatewayError::Internal {
            context: context.to_string(),
            source: source.into(),
        }
    }

    fn method_not_allowed(method: axum::http::Method) -> Self {
        GatewayError::MethodNotAllowed { method }
    }

    fn render(
        status: StatusCode,
        body: impl Into<String>,
        use_error_level: bool,
        log_message: Option<String>,
    ) -> Response {
        Self::log(use_error_level, log_message);
        let error_body = body.into();
        (status, Json(ErrorBody { error: error_body })).into_response()
    }

    fn log(use_error_level: bool, message: Option<String>) {
        let log_fn = select_logger(use_error_level);
        match message {
            Some(msg) => log_fn(&msg),
            None => log_fn(default_log_message(use_error_level)),
        }
    }
}

fn select_logger(is_error: bool) -> fn(&str) {
    if is_error { log_error } else { log_warn }
}

fn default_log_message(is_error: bool) -> &'static str {
    if is_error {
        "gateway error occurred without additional context"
    } else {
        "gateway warning occurred without additional context"
    }
}

fn log_error(message: &str) {
    error!("{message}");
}

fn log_warn(message: &str) {
    warn!("{message}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use reqwest::header::{HeaderName, HeaderValue};

    #[test]
    fn request_headers_remove_hop_by_hop_and_custom_tokens() {
        let request = match Request::builder()
            .method("POST")
            .uri("/v1/completions")
            .header("Connection", "keep-alive, Custom-Hop")
            .header("Upgrade", "websocket")
            .header("Custom-Hop", "value")
            .header("Authorization", "Bearer downstream")
            .header("Content-Length", "42")
            .header("Host", "localhost")
            .header("X-Correlation-Id", "abc123")
            .body(Body::empty())
        {
            Ok(request) => request,
            Err(err) => panic!("failed to build request: {err}"),
        };
        let (parts, _) = request.into_parts();
        let route = ModelRoute {
            target: "test".to_string(),
            base_url: "https://example.com".to_string(),
            auth: ResolvedAuth::None,
            capabilities: vec![],
            max_total_tokens: None,
            cost_ceiling_usd: None,
        };

        let headers = build_forward_headers(&parts, &route);

        assert!(!headers.contains_key("connection"));
        assert!(!headers.contains_key("keep-alive"));
        assert!(!headers.contains_key("custom-hop"));
        assert!(!headers.contains_key("upgrade"));
        assert!(!headers.contains_key("authorization"));
        assert!(!headers.contains_key("content-length"));
        assert!(headers.contains_key("x-correlation-id"));
    }

    #[test]
    fn response_headers_remove_hop_by_hop_and_connection_tokens() {
        let mut headers = ReqwestHeaderMap::new();
        headers.insert(
            reqwest::header::CONNECTION,
            HeaderValue::from_static("keep-alive, X-Trace"),
        );
        headers.insert(
            reqwest::header::TRANSFER_ENCODING,
            HeaderValue::from_static("chunked"),
        );
        headers.insert(
            HeaderName::from_static("x-trace"),
            HeaderValue::from_static("trace-id"),
        );
        headers.insert(
            HeaderName::from_static("x-forwarded-for"),
            HeaderValue::from_static("127.0.0.1"),
        );
        headers.insert(
            reqwest::header::CONTENT_LENGTH,
            HeaderValue::from_static("1024"),
        );

        let skip = response_skip_headers(&headers);

        assert!(skip.contains(&reqwest::header::CONNECTION));
        assert!(skip.contains(&reqwest::header::TRANSFER_ENCODING));
        assert!(skip.contains(&HeaderName::from_static("x-trace")));
        assert!(skip.contains(&reqwest::header::CONTENT_LENGTH));
        assert!(!skip.contains(&HeaderName::from_static("x-forwarded-for")));
    }
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

impl IntoResponse for GatewayError {
    fn into_response(self) -> Response {
        match &self {
            GatewayError::InvalidRequest { status, context } => {
                Self::render(*status, context.clone(), true, Some(context.clone()))
            }
            GatewayError::UnknownModel { model } => {
                let msg = format!("model '{model}' is not configured");
                Self::render(StatusCode::NOT_FOUND, msg.clone(), false, Some(msg))
            }
            GatewayError::UpstreamFailure { model, source } => {
                let detail = format!("upstream request failed for model '{model}': {source}");
                Self::render(
                    StatusCode::BAD_GATEWAY,
                    "upstream request failed",
                    true,
                    Some(detail),
                )
            }
            GatewayError::Internal { context, source } => Self::render(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal gateway error",
                true,
                Some(format!("{context}: {source:#}")),
            ),
            GatewayError::MethodNotAllowed { method } => {
                let detail = format!("method {method} not allowed");
                Self::render(
                    StatusCode::METHOD_NOT_ALLOWED,
                    detail.clone(),
                    false,
                    Some(detail),
                )
            }
        }
    }
}
