use std::{
    env,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::State,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use http::StatusCode;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::Mutex;
use tower_http::trace::TraceLayer;
use tracing::{info, warn};
use tracing_subscriber::{EnvFilter, fmt};
use url::Url;

const PROMPT_LOG_EVENT: &str = "completion_prompt";
const RESPONSE_LOG_EVENT: &str = "completion_response";

#[derive(Clone, Debug)]
pub struct GatewaySettings {
    pub bind_addr: String,
    pub vllm_endpoint: Url,
    pub model: String,
    pub timeout: Duration,
    pub rate_limit: RateLimitSettings,
    pub log_truncate: usize,
}

impl GatewaySettings {
    const DEFAULT_BIND_ADDR: &str = "0.0.0.0:8086";
    const DEFAULT_MODEL: &str = "tyrum-stub-8b";
    const DEFAULT_VLLM_URL: &str = "http://vllm-gateway:8000/v1/completions";
    const DEFAULT_TIMEOUT_MS: u64 = 20_000;
    const DEFAULT_RATE_LIMIT_PER_SECOND: u64 = 5;
    const DEFAULT_LOG_TRUNCATE: usize = 256;

    pub fn from_env() -> Result<Self> {
        let bind_addr = env::var("LLM_GATEWAY_BIND_ADDR")
            .unwrap_or_else(|_| Self::DEFAULT_BIND_ADDR.to_string());

        let model =
            env::var("LLM_GATEWAY_MODEL").unwrap_or_else(|_| Self::DEFAULT_MODEL.to_string());

        let vllm_url_raw =
            env::var("LLM_VLLM_URL").unwrap_or_else(|_| Self::DEFAULT_VLLM_URL.to_string());
        let vllm_endpoint = Url::parse(&vllm_url_raw)
            .with_context(|| format!("parsing LLM_VLLM_URL='{vllm_url_raw}'"))?;

        let timeout_ms = env::var("LLM_GATEWAY_TIMEOUT_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(Self::DEFAULT_TIMEOUT_MS);
        let timeout = Duration::from_millis(timeout_ms);

        let rate_limit_per_second = env::var("LLM_RATE_LIMIT_PER_SECOND")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(Self::DEFAULT_RATE_LIMIT_PER_SECOND);
        let rate_limit = RateLimitSettings::new(rate_limit_per_second, Duration::from_secs(1));

        let log_truncate = env::var("LLM_LOG_TRUNCATE")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(Self::DEFAULT_LOG_TRUNCATE);

        Ok(Self {
            bind_addr,
            vllm_endpoint,
            model,
            timeout,
            rate_limit,
            log_truncate,
        })
    }
}

#[derive(Clone, Copy, Debug)]
pub struct RateLimitSettings {
    pub max_requests: u64,
    pub per: Duration,
}

impl RateLimitSettings {
    pub fn new(max_requests: u64, per: Duration) -> Self {
        let safe_max = if max_requests == 0 { 1 } else { max_requests };
        Self {
            max_requests: safe_max,
            per,
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    client: reqwest::Client,
    endpoint: Url,
    model: Arc<str>,
    log_truncate: usize,
    rate_limiter: Arc<RateLimiter>,
}

impl AppState {
    pub fn try_from(settings: &GatewaySettings) -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(settings.timeout)
            .build()
            .context("building completion http client")?;

        let rate_limiter = RateLimiter::new(settings.rate_limit);

        Ok(Self {
            client,
            endpoint: settings.vllm_endpoint.clone(),
            model: Arc::from(settings.model.clone()),
            log_truncate: settings.log_truncate,
            rate_limiter: Arc::new(rate_limiter),
        })
    }

    pub fn from_parts(
        client: reqwest::Client,
        endpoint: Url,
        model: impl Into<Arc<str>>,
        log_truncate: usize,
        rate_limit: RateLimitSettings,
    ) -> Self {
        Self {
            client,
            endpoint,
            model: model.into(),
            log_truncate,
            rate_limiter: Arc::new(RateLimiter::new(rate_limit)),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CompletionRequest {
    pub prompt: String,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub top_p: Option<f32>,
    #[serde(default)]
    pub frequency_penalty: Option<f32>,
    #[serde(default)]
    pub presence_penalty: Option<f32>,
    #[serde(default)]
    pub stop: Option<Vec<String>>,
    #[serde(default)]
    pub stream: bool,
}

#[derive(Debug, Serialize)]
pub struct CompletionResponse {
    pub id: String,
    pub created: u64,
    pub model: String,
    pub choices: Vec<CompletionChoice>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<CompletionUsage>,
}

#[derive(Debug, Serialize)]
pub struct CompletionChoice {
    pub index: usize,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CompletionUsage {
    pub prompt_tokens: u64,
    pub completion_tokens: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u64>,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

#[derive(Debug, Error)]
pub enum GatewayError {
    #[error("streaming completions are not supported yet")]
    StreamingNotSupported,
    #[error("rate limit exceeded")]
    RateLimited,
    #[error("upstream vLLM request failed: {0}")]
    UpstreamFailure(String),
    #[error("invalid upstream response: {0}")]
    InvalidResponse(String),
}

impl IntoResponse for GatewayError {
    fn into_response(self) -> Response {
        match self {
            Self::StreamingNotSupported => (
                StatusCode::NOT_IMPLEMENTED,
                Json(ErrorBody {
                    code: "stream_not_supported",
                    message: "Streaming completions are not implemented yet",
                    detail: None,
                }),
            )
                .into_response(),
            Self::RateLimited => (
                StatusCode::TOO_MANY_REQUESTS,
                Json(ErrorBody {
                    code: "rate_limited",
                    message: "Too many completion requests",
                    detail: None,
                }),
            )
                .into_response(),
            Self::UpstreamFailure(detail) => (
                StatusCode::BAD_GATEWAY,
                Json(ErrorBody {
                    code: "upstream_unavailable",
                    message: "vLLM gateway is unavailable",
                    detail: Some(detail),
                }),
            )
                .into_response(),
            Self::InvalidResponse(detail) => (
                StatusCode::BAD_GATEWAY,
                Json(ErrorBody {
                    code: "upstream_invalid",
                    message: "vLLM returned an unexpected response",
                    detail: Some(detail),
                }),
            )
                .into_response(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct VllmCompletionResponse {
    id: String,
    created: u64,
    model: String,
    choices: Vec<VllmChoice>,
    #[serde(default)]
    usage: Option<VllmUsage>,
}

#[derive(Debug, Deserialize)]
struct VllmChoice {
    index: usize,
    text: String,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct VllmUsage {
    #[serde(default)]
    prompt_tokens: Option<u64>,
    #[serde(default)]
    completion_tokens: Option<u64>,
    #[serde(default)]
    total_tokens: Option<u64>,
}

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/completions", post(completions))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
}

#[tracing::instrument(skip_all)]
async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok" })
}

#[tracing::instrument(skip_all)]
async fn completions(
    State(state): State<AppState>,
    Json(request): Json<CompletionRequest>,
) -> Result<Json<CompletionResponse>, GatewayError> {
    if request.stream {
        warn!("streaming completions requested; responding with not implemented");
        return Err(GatewayError::StreamingNotSupported);
    }

    state.rate_limiter.check().await?;

    log_prompt(&request.prompt, state.log_truncate);

    let response = forward_to_vllm(&state, &request).await?;

    log_response(&response, state.log_truncate);

    Ok(Json(response))
}

async fn forward_to_vllm(
    state: &AppState,
    request: &CompletionRequest,
) -> Result<CompletionResponse, GatewayError> {
    let payload = VllmCompletionRequest {
        model: state.model.as_ref(),
        prompt: &request.prompt,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        top_p: request.top_p,
        frequency_penalty: request.frequency_penalty,
        presence_penalty: request.presence_penalty,
        stop: request.stop.as_ref(),
    };

    let response = state
        .client
        .post(state.endpoint.clone())
        .json(&payload)
        .send()
        .await
        .map_err(|error| GatewayError::UpstreamFailure(error.to_string()))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "<unavailable>".to_string());
        return Err(GatewayError::UpstreamFailure(format!(
            "status={status} body={body}"
        )));
    }

    let upstream: VllmCompletionResponse = response
        .json()
        .await
        .map_err(|error| GatewayError::InvalidResponse(error.to_string()))?;

    Ok(normalise_response(upstream))
}

#[derive(Serialize)]
struct VllmCompletionRequest<'a> {
    model: &'a str,
    prompt: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_p: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frequency_penalty: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    presence_penalty: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<&'a Vec<String>>,
}

#[derive(Debug)]
struct RateLimiter {
    limit: u64,
    window: Duration,
    inner: Mutex<RateWindow>,
}

#[derive(Debug)]
struct RateWindow {
    start: Instant,
    count: u64,
}

impl RateLimiter {
    fn new(settings: RateLimitSettings) -> Self {
        Self {
            limit: settings.max_requests,
            window: settings.per,
            inner: Mutex::new(RateWindow {
                start: Instant::now(),
                count: 0,
            }),
        }
    }

    async fn check(&self) -> std::result::Result<(), GatewayError> {
        let mut state = self.inner.lock().await;
        let now = Instant::now();

        if now.duration_since(state.start) >= self.window {
            state.start = now;
            state.count = 0;
        }

        if state.count < self.limit {
            state.count += 1;
            Ok(())
        } else {
            warn!("llm gateway rate limit exceeded");
            Err(GatewayError::RateLimited)
        }
    }
}

fn normalise_response(upstream: VllmCompletionResponse) -> CompletionResponse {
    let choices = upstream
        .choices
        .into_iter()
        .map(|choice| CompletionChoice {
            index: choice.index,
            text: choice.text,
            finish_reason: choice.finish_reason,
        })
        .collect();

    let usage =
        upstream.usage.and_then(
            |usage| match (usage.prompt_tokens, usage.completion_tokens) {
                (Some(prompt_tokens), Some(completion_tokens)) => Some(CompletionUsage {
                    prompt_tokens,
                    completion_tokens,
                    total_tokens: usage.total_tokens,
                }),
                _ => None,
            },
        );

    CompletionResponse {
        id: upstream.id,
        created: upstream.created,
        model: upstream.model,
        choices,
        usage,
    }
}

fn log_prompt(prompt: &str, limit: usize) {
    let preview = truncate(prompt, limit);
    info!(event = PROMPT_LOG_EVENT, preview = %preview, "forwarding completion prompt");
}

fn log_response(response: &CompletionResponse, limit: usize) {
    let preview = response
        .choices
        .first()
        .map(|choice| truncate(&choice.text, limit))
        .unwrap_or_else(|| "<empty>".to_string());
    info!(event = RESPONSE_LOG_EVENT, preview = %preview, "received vLLM response");
}

fn truncate(value: &str, limit: usize) -> String {
    if limit == 0 {
        return String::new();
    }
    if value.len() <= limit {
        value.to_string()
    } else {
        format!("{}…", &value[..limit])
    }
}

pub fn init_tracing() -> Result<()> {
    let filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tyrum_llm=info"));

    let _ = fmt().with_env_filter(filter).with_target(false).try_init();
    Ok(())
}

#[cfg(test)]
mod truncation_tests {
    use super::truncate;

    #[test]
    fn truncates_when_limit_exceeded() {
        assert_eq!(truncate("abcdef", 3), "abc…");
    }

    #[test]
    fn returns_original_when_within_limit() {
        assert_eq!(truncate("abc", 5), "abc");
    }
}

#[cfg(test)]
mod logging_tests {
    use super::{CompletionChoice, CompletionResponse, log_prompt, log_response};

    #[test]
    fn log_helpers_do_not_panic_on_empty() {
        log_prompt("", 16);
        let response = CompletionResponse {
            id: "test".into(),
            created: 0,
            model: "model".into(),
            choices: vec![CompletionChoice {
                index: 0,
                text: String::new(),
                finish_reason: None,
            }],
            usage: None,
        };
        log_response(&response, 12);
    }
}
