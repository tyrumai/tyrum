use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, anyhow};
use axum::{
    Router,
    body::Body,
    extract::{OriginalUri, State},
    http::{Request, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
};
use bytes::Bytes;
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
    init_tracing();

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

fn init_tracing() {
    let env_filter = env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string());
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(env_filter))
        .with(tracing_subscriber::fmt::layer())
        .init();
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
        let config: GatewayConfig = if contents.trim().is_empty() {
            GatewayConfig::default()
        } else {
            serde_yaml::from_str(&contents)
                .with_context(|| format!("parsing model gateway config at {}", path.display()))?
        };

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

        Ok(Self { defaults, routes })
    }
}

fn sanitize_base_url(raw: &str) -> anyhow::Result<String> {
    let url = reqwest::Url::parse(raw).with_context(|| format!("invalid endpoint URL '{raw}'"))?;
    let mut cleaned = url.clone();
    cleaned.set_query(None);
    cleaned.set_fragment(None);
    Ok(cleaned.into())
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
                let header_val = HeaderValue::from_str(&format!("Bearer {token}"))
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
    let (route, model) = resolve_model(&state, &body_bytes)?;
    let upstream_url = build_forward_url(&route.base_url, &original_uri)?;
    let headers = build_forward_headers(&parts, route);
    let upstream_response =
        forward_request(&state, method, upstream_url, headers, body_bytes, &model).await?;
    build_response(upstream_response).await
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

fn resolve_model<'routes>(
    state: &'routes AppState,
    body_bytes: &[u8],
) -> Result<(&'routes ModelRoute, String), GatewayError> {
    let model = extract_model(body_bytes)?;
    let route = state
        .routes
        .get(model.as_str())
        .ok_or_else(|| GatewayError::unknown_model(model.clone()))?;
    Ok((route, model))
}

fn build_forward_headers(
    parts: &axum::http::request::Parts,
    route: &ModelRoute,
) -> ReqwestHeaderMap {
    let mut headers = ReqwestHeaderMap::new();
    for (name, value) in parts.headers.iter() {
        if name == axum::http::header::HOST
            || name == axum::http::header::CONTENT_LENGTH
            || name == axum::http::header::AUTHORIZATION
        {
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

async fn build_response(upstream_response: reqwest::Response) -> Result<Response, GatewayError> {
    let status = upstream_response.status();
    let upstream_headers = upstream_response.headers().clone();
    let bytes = upstream_response
        .bytes()
        .await
        .map_err(|err| GatewayError::internal("reading upstream response", err))?;

    let mut response_builder = Response::builder().status(status);
    if let Some(headers_mut) = response_builder.headers_mut() {
        for (name, value) in upstream_headers.iter() {
            if name == reqwest::header::CONTENT_LENGTH {
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

fn extract_model(body: &[u8]) -> Result<String, GatewayError> {
    let value: Value = serde_json::from_slice(body)
        .map_err(|err| GatewayError::invalid_request("invalid JSON payload", err))?;
    value
        .get("model")
        .and_then(|m| m.as_str())
        .map(|m| m.to_string())
        .ok_or_else(|| {
            GatewayError::invalid_request(
                "request body missing 'model' field",
                anyhow!("missing model field"),
            )
        })
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
        log_error: bool,
        log_message: Option<String>,
    ) -> Response {
        Self::log(log_error, log_message);
        let error_body = body.into();
        (status, Json(ErrorBody { error: error_body })).into_response()
    }

    #[allow(clippy::cognitive_complexity)]
    fn log(log_error: bool, message: Option<String>) {
        match (log_error, message) {
            (true, Some(msg)) => error!("{msg}"),
            (false, Some(msg)) => warn!("{msg}"),
            (_, None) => {}
        }
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
