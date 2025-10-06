use std::{
    env,
    future::Future,
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};

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
use tracing::{field, info_span};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

const DEFAULT_ENDPOINT: &str = "http://otel-collector:4317";
const EXPORT_TIMEOUT_SECS: u64 = 5;
const METER_NAME: &str = "tyrum-executor-cli";
const DURATION_METRIC_NAME: &str = "tyrum_executor_cli_attempt_duration_seconds";
const COUNT_METRIC_NAME: &str = "tyrum_executor_cli_attempt_total";

/// Telemetry context attached to each CLI command attempt.
#[derive(Clone, Debug)]
pub struct AttemptContext {
    command: String,
    working_dir: String,
}

impl AttemptContext {
    /// Construct a new context capturing the command name and working directory.
    pub fn new(command: &str, working_dir: &Path) -> Self {
        Self {
            command: command.to_string(),
            working_dir: working_dir.display().to_string(),
        }
    }

    /// Command name recorded in spans and metrics.
    pub fn command(&self) -> &str {
        &self.command
    }

    /// Working directory recorded in spans and metrics.
    pub fn working_dir(&self) -> &str {
        &self.working_dir
    }
}

/// Record an executor attempt, emitting spans and metrics around the future.
pub async fn record_attempt<Fut, T, E>(
    context: &AttemptContext,
    future: Fut,
) -> (Result<T, E>, Duration)
where
    Fut: Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let span = info_span!(
        "executor.cli.attempt",
        command = context.command(),
        working_dir = context.working_dir(),
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

    record_metrics(context, outcome, elapsed);

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

static METRICS: once_cell::sync::OnceCell<Mutex<MetricsCache>> = once_cell::sync::OnceCell::new();

fn record_metrics(context: &AttemptContext, outcome: &str, duration: Duration) {
    let instruments = metrics_instruments();
    let attributes = [
        KeyValue::new("executor.cli.command", context.command().to_string()),
        KeyValue::new(
            "executor.cli.working_dir",
            context.working_dir().to_string(),
        ),
        KeyValue::new("executor.cli.outcome", outcome.to_string()),
    ];

    instruments
        .duration
        .record(duration.as_secs_f64(), &attributes);
    instruments.count.add(1, &attributes);
}

fn metrics_instruments() -> MetricsInstruments {
    let provider = global::meter_provider();
    let cache = METRICS.get_or_init(|| Mutex::new(MetricsCache::default()));
    let mut guard = cache.lock().expect("metrics cache poisoned");

    if let Some(instruments) = &guard.instruments {
        return instruments.clone();
    }

    let meter = provider.meter(METER_NAME);
    let instruments = MetricsInstruments {
        duration: meter
            .f64_histogram(DURATION_METRIC_NAME)
            .with_unit("s")
            .with_description("Duration of CLI executor attempts")
            .build(),
        count: meter
            .u64_counter(COUNT_METRIC_NAME)
            .with_description("CLI executor attempts recorded")
            .build(),
    };

    guard.instruments = Some(instruments.clone());

    instruments
}

fn exporter_config(endpoint: &str) -> ExportConfig {
    ExportConfig {
        endpoint: Some(endpoint.to_string()),
        protocol: Protocol::Grpc,
        timeout: Some(Duration::from_secs(EXPORT_TIMEOUT_SECS)),
    }
}

/// Guard that installs tracing + OpenTelemetry exporters for the executor service.
pub struct TelemetryGuard {
    tracer_provider: SdkTracerProvider,
    meter_provider: SdkMeterProvider,
    logger_provider: SdkLoggerProvider,
}

impl TelemetryGuard {
    /// Install global tracing, metrics, and logging exporters for the CLI executor.
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
        let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into());

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
