use std::{
    env,
    future::Future,
    sync::Mutex,
    time::{Duration, Instant},
};

use crate::HttpRetryOutcome;
use once_cell::sync::OnceCell;
use opentelemetry::{
    KeyValue, global,
    metrics::{Counter, Histogram},
    trace::TracerProvider,
};
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{ExportConfig, Protocol, WithExportConfig};
use opentelemetry_sdk::{
    Resource, logs::SdkLoggerProvider, metrics::SdkMeterProvider,
    propagation::TraceContextPropagator, trace::SdkTracerProvider,
};
use reqwest::Method;
use tracing::{field, info_span, warn};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use url::Url;

const DEFAULT_ENDPOINT: &str = "http://otel-collector:4317";
const EXPORT_TIMEOUT_SECS: u64 = 5;
const METER_NAME: &str = "tyrum-executor-http";
const DURATION_METRIC_NAME: &str = "tyrum_executor_http_attempt_duration_seconds";
const COUNT_METRIC_NAME: &str = "tyrum_executor_http_attempt_total";
const RETRY_COUNT_METRIC_NAME: &str = "executor_http.retry";

#[derive(Clone, Debug)]
pub struct AttemptContext {
    host: String,
    method: String,
}

impl AttemptContext {
    pub fn new(method: &Method, url: &Url) -> Self {
        Self {
            host: url.host_str().unwrap_or("unknown").to_string(),
            method: method.as_str().to_string(),
        }
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    pub fn method(&self) -> &str {
        &self.method
    }
}

pub async fn record_attempt<Fut, T, E>(
    context: &AttemptContext,
    attempt: u32,
    max_attempts: u32,
    future: Fut,
) -> (Result<T, E>, Duration)
where
    Fut: Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let span = info_span!(
        "executor.http.attempt",
        target_host = context.host(),
        method = context.method(),
        attempt,
        max_attempts,
        outcome = field::Empty,
        error = field::Empty,
        duration_ms = field::Empty,
    );
    let _guard = span.enter();
    let started = Instant::now();

    let result = future.await;
    let elapsed = started.elapsed();
    let outcome = if result.is_ok() { "success" } else { "error" };

    span.record("outcome", outcome);
    span.record("duration_ms", elapsed.as_millis() as i64);

    if let Err(err) = &result {
        span.record("error", tracing::field::display(err));
    }

    record_metrics(context, attempt, outcome, elapsed);

    (result, elapsed)
}

#[derive(Clone)]
struct MetricsInstruments {
    duration: Histogram<f64>,
    count: Counter<u64>,
}

#[derive(Default)]
struct MetricsCache {
    instruments: Option<MetricsInstruments>,
}

static METRICS: OnceCell<Mutex<MetricsCache>> = OnceCell::new();

#[derive(Clone)]
struct RetryInstruments {
    count: Counter<u64>,
}

static RETRIES: OnceCell<Mutex<Option<RetryInstruments>>> = OnceCell::new();

fn record_metrics(context: &AttemptContext, attempt: u32, outcome: &str, duration: Duration) {
    let instruments = metrics_instruments();
    let attributes = [
        KeyValue::new("executor.http.host", context.host().to_string()),
        KeyValue::new("executor.http.method", context.method().to_string()),
        KeyValue::new("executor.http.outcome", outcome.to_string()),
        KeyValue::new("executor.http.attempt_number", attempt as i64),
    ];

    instruments
        .duration
        .record(duration.as_secs_f64(), &attributes);
    instruments.count.add(1, &attributes);
}

pub fn record_retry_event(context: &AttemptContext, attempt: u32, outcome: &HttpRetryOutcome) {
    let instruments = retry_instruments();

    let mut attributes = vec![
        KeyValue::new("executor.http.host", context.host().to_string()),
        KeyValue::new("executor.http.method", context.method().to_string()),
        KeyValue::new("executor.http.attempt_number", attempt as i64),
    ];

    let (kind, status, reason) = retry_outcome_details(outcome);
    if let Some(code) = status {
        attributes.push(KeyValue::new("executor.http.retry_status", code as i64));
    }
    attributes.push(KeyValue::new("executor.http.retry_kind", kind.to_string()));
    instruments.count.add(1, &attributes);

    tracing::info!(
        target: "executor_http.retry",
        attempt,
        method = context.method(),
        host = context.host(),
        "retry scheduled kind={} status={:?} reason={:?}",
        kind,
        status,
        reason
    );
}

fn retry_outcome_details(outcome: &HttpRetryOutcome) -> (&'static str, Option<u16>, Option<&str>) {
    match outcome {
        HttpRetryOutcome::Status(code) => ("status", Some(*code), None),
        HttpRetryOutcome::Timeout => ("timeout", None, None),
        HttpRetryOutcome::Connect => ("connect", None, None),
        HttpRetryOutcome::Other(message) => ("other", None, Some(message.as_str())),
    }
}

fn metrics_instruments() -> MetricsInstruments {
    let provider = global::meter_provider();
    let cache = METRICS.get_or_init(|| Mutex::new(MetricsCache::default()));
    let mut guard = match cache.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            warn!("metrics cache lock poisoned; continuing with cached instruments");
            poisoned.into_inner()
        }
    };

    if let Some(instruments) = &guard.instruments {
        return instruments.clone();
    }

    let meter = provider.meter(METER_NAME);
    let instruments = MetricsInstruments {
        duration: meter
            .f64_histogram(DURATION_METRIC_NAME)
            .with_unit("s")
            .with_description("Duration of HTTP executor attempts")
            .build(),
        count: meter
            .u64_counter(COUNT_METRIC_NAME)
            .with_description("HTTP executor attempts recorded")
            .build(),
    };

    guard.instruments = Some(instruments.clone());

    instruments
}

fn retry_instruments() -> RetryInstruments {
    let provider = global::meter_provider();
    let cache = RETRIES.get_or_init(|| Mutex::new(None));
    let mut guard = match cache.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            warn!("retry metrics cache lock poisoned; continuing");
            poisoned.into_inner()
        }
    };

    if let Some(instruments) = &*guard {
        return instruments.clone();
    }

    let meter = provider.meter(METER_NAME);
    let instruments = RetryInstruments {
        count: meter
            .u64_counter(RETRY_COUNT_METRIC_NAME)
            .with_description("HTTP executor retries scheduled")
            .build(),
    };

    *guard = Some(instruments.clone());

    instruments
}

fn exporter_config(endpoint: &str) -> ExportConfig {
    ExportConfig {
        endpoint: Some(endpoint.to_string()),
        protocol: Protocol::Grpc,
        timeout: Some(Duration::from_secs(EXPORT_TIMEOUT_SECS)),
    }
}

pub struct TelemetryGuard {
    tracer_provider: SdkTracerProvider,
    meter_provider: SdkMeterProvider,
    logger_provider: SdkLoggerProvider,
}

impl TelemetryGuard {
    pub fn install(service_name: &'static str) -> anyhow::Result<Self> {
        let endpoint = env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
            .unwrap_or_else(|_| DEFAULT_ENDPOINT.to_string());

        let resource = Resource::builder()
            .with_attributes([KeyValue::new("service.name", service_name)])
            .build();

        let tracer_exporter = opentelemetry_otlp::SpanExporter::builder()
            .with_tonic()
            .with_export_config(exporter_config(&endpoint))
            .build()?;

        let tracer_provider = SdkTracerProvider::builder()
            .with_resource(resource.clone())
            .with_batch_exporter(tracer_exporter)
            .build();

        global::set_tracer_provider(tracer_provider.clone());
        global::set_text_map_propagator(TraceContextPropagator::default());

        let metric_exporter = opentelemetry_otlp::MetricExporter::builder()
            .with_tonic()
            .with_export_config(exporter_config(&endpoint))
            .build()?;

        let meter_provider = SdkMeterProvider::builder()
            .with_resource(resource.clone())
            .with_periodic_exporter(metric_exporter)
            .build();

        global::set_meter_provider(meter_provider.clone());

        let log_exporter = opentelemetry_otlp::LogExporter::builder()
            .with_tonic()
            .with_export_config(exporter_config(&endpoint))
            .build()?;

        let logger_provider = SdkLoggerProvider::builder()
            .with_resource(resource)
            .with_batch_exporter(log_exporter)
            .build();

        let log_bridge = OpenTelemetryTracingBridge::new(&logger_provider);
        let tracer = tracer_provider.tracer(service_name);
        let env_filter =
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());

        tracing_subscriber::registry()
            .with(env_filter)
            .with(OpenTelemetryLayer::new(tracer))
            .with(log_bridge)
            .with(tracing_subscriber::fmt::layer())
            .init();

        Ok(Self {
            tracer_provider,
            meter_provider,
            logger_provider,
        })
    }
}

impl Drop for TelemetryGuard {
    fn drop(&mut self) {
        if let Err(err) = self.tracer_provider.shutdown() {
            eprintln!("tracer provider shutdown error: {err}");
        }
        if let Err(err) = self.meter_provider.shutdown() {
            eprintln!("meter provider shutdown error: {err}");
        }
        if let Err(err) = self.logger_provider.shutdown() {
            eprintln!("logger provider shutdown error: {err}");
        }
    }
}
