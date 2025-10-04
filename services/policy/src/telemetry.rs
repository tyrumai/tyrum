use std::{env, time::Duration};

use once_cell::sync::Lazy;
use opentelemetry::{KeyValue, global, metrics::Counter, trace::TracerProvider};
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{ExportConfig, Protocol, WithExportConfig};
use opentelemetry_sdk::{
    Resource, logs::SdkLoggerProvider, metrics::SdkMeterProvider,
    propagation::TraceContextPropagator, trace::SdkTracerProvider,
};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::Decision;

const DEFAULT_ENDPOINT: &str = "http://otel-collector:4317";
const EXPORT_TIMEOUT: Duration = Duration::from_secs(5);

fn exporter_config(endpoint: &str) -> ExportConfig {
    ExportConfig {
        endpoint: Some(endpoint.to_string()),
        protocol: Protocol::Grpc,
        timeout: Some(EXPORT_TIMEOUT),
    }
}

static DECISION_COUNTER: Lazy<Counter<u64>> = Lazy::new(|| {
    global::meter("tyrum-policy")
        .u64_counter("tyrum_policy_decisions_total")
        .with_description("Number of policy decisions emitted by the Tyrum policy service")
        .build()
});

pub struct TelemetryGuard {
    tracer_provider: SdkTracerProvider,
    meter_provider: SdkMeterProvider,
    logger_provider: SdkLoggerProvider,
}

impl TelemetryGuard {
    pub fn install(
        service_name: &'static str,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
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

        let _ = global::set_meter_provider(meter_provider.clone());

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

pub fn record_policy_decision(decision: Decision) {
    let outcome = match decision {
        Decision::Approve => "approve",
        Decision::Escalate => "escalate",
        Decision::Deny => "deny",
    };

    DECISION_COUNTER.add(1, &[KeyValue::new("policy.decision", outcome)]);
}
