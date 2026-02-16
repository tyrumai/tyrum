use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::{convert::TryFrom, future::Future};

use once_cell::sync::OnceCell;
use opentelemetry::{
    KeyValue, global,
    metrics::{Counter, Histogram},
};
use tracing::{field, info_span, warn};

use crate::pipeline::{DiscoveryOutcome, DiscoveryStrategy};

const METER_NAME: &str = "tyrum-discovery";
const DURATION_METRIC_NAME: &str = "tyrum_discovery_attempt_duration_seconds";
const COUNT_METRIC_NAME: &str = "tyrum_discovery_attempt_total";
const CACHE_HIT_METRIC_NAME: &str = "discovery.cache.hit";
const PROBE_DURATION_METRIC_NAME: &str = "tyrum_discovery_probe_duration_seconds";
const PROBE_COUNT_METRIC_NAME: &str = "tyrum_discovery_probe_total";

#[derive(Clone)]
struct MetricsInstruments {
    duration: Histogram<f64>,
    count: Counter<u64>,
}

#[derive(Default)]
struct MetricsCache {
    provider: Option<Arc<dyn opentelemetry::metrics::MeterProvider + Send + Sync>>,
    instruments: Option<MetricsInstruments>,
}

static METRICS: OnceCell<Mutex<MetricsCache>> = OnceCell::new();
static CACHE_METRICS: OnceCell<Mutex<CacheMetricCache>> = OnceCell::new();
static PROBE_METRICS: OnceCell<Mutex<ProbeMetricCache>> = OnceCell::new();

#[derive(Default)]
struct CacheMetricCache {
    provider: Option<Arc<dyn opentelemetry::metrics::MeterProvider + Send + Sync>>,
    counter: Option<Counter<u64>>,
}

#[derive(Clone, Copy)]
pub(crate) enum CacheEvent {
    Hit,
    Miss,
    Error,
}

#[derive(Clone, Copy)]
pub(crate) enum ProbeStatus {
    Success,
    Miss,
    Timeout,
    Error,
}

pub(crate) fn record_cache_event(event: CacheEvent) {
    let counter = cache_counter();
    let (hit, status) = match event {
        CacheEvent::Hit => ("true", "hit"),
        CacheEvent::Miss => ("false", "miss"),
        CacheEvent::Error => ("false", "error"),
    };
    let labels = [KeyValue::new("hit", hit), KeyValue::new("status", status)];
    counter.add(1, &labels);
}

pub(crate) async fn record_step<F, Fut>(
    strategy: DiscoveryStrategy,
    subject: &str,
    attempt: F,
) -> DiscoveryOutcome
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = DiscoveryOutcome>,
{
    let span = info_span!(
        "discovery.step",
        strategy = strategy.as_str(),
        subject,
        outcome = field::Empty,
        retry_after_ms = field::Empty,
    );
    let _guard = span.enter();
    let start = Instant::now();

    let outcome = attempt().await;
    let elapsed = start.elapsed();

    let outcome_label = outcome.label();
    span.record("outcome", outcome_label);

    if let DiscoveryOutcome::RetryLater {
        retry_after: Some(delay),
    } = &outcome
    {
        let millis = i64::try_from(delay.as_millis()).unwrap_or(i64::MAX);
        span.record("retry_after_ms", millis);
    }

    record_metrics(strategy, &outcome, elapsed);

    outcome
}

pub(crate) fn record_probe(status: ProbeStatus, duration: Duration) {
    let instruments = probe_instruments();
    let attributes = [KeyValue::new("probe.status", status.as_str())];
    instruments
        .duration
        .record(duration.as_secs_f64(), &attributes);
    instruments.count.add(1, &attributes);
}

fn record_metrics(strategy: DiscoveryStrategy, outcome: &DiscoveryOutcome, duration: Duration) {
    let instruments = metrics_instruments();

    let attributes = [
        KeyValue::new("discovery.strategy", strategy.as_str()),
        KeyValue::new("discovery.outcome", outcome.label()),
    ];

    instruments
        .duration
        .record(duration.as_secs_f64(), &attributes);
    instruments.count.add(1, &attributes);
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

    if guard
        .provider
        .as_ref()
        .is_some_and(|current| Arc::ptr_eq(current, &provider))
        && let Some(instruments) = &guard.instruments
    {
        return instruments.clone();
    }

    let meter = provider.meter(METER_NAME);
    let instruments = MetricsInstruments {
        duration: meter
            .f64_histogram(DURATION_METRIC_NAME)
            .with_unit("s")
            .with_description("Duration of discovery attempts by strategy and outcome")
            .build(),
        count: meter
            .u64_counter(COUNT_METRIC_NAME)
            .with_description("Count of discovery attempts by strategy and outcome")
            .build(),
    };

    guard.provider = Some(provider);
    guard.instruments = Some(instruments.clone());

    instruments
}

fn cache_counter() -> Counter<u64> {
    let provider = global::meter_provider();
    let cache = CACHE_METRICS.get_or_init(|| Mutex::new(CacheMetricCache::default()));
    let mut guard = match cache.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            warn!("cache metric lock poisoned; continuing with cached counter");
            poisoned.into_inner()
        }
    };

    if guard
        .provider
        .as_ref()
        .is_some_and(|current| Arc::ptr_eq(current, &provider))
        && let Some(counter) = &guard.counter
    {
        return counter.clone();
    }

    let meter = provider.meter(METER_NAME);
    let counter = meter
        .u64_counter(CACHE_HIT_METRIC_NAME)
        .with_description("Discovery cache hit/miss events")
        .build();

    guard.provider = Some(provider);
    guard.counter = Some(counter.clone());

    counter
}

#[derive(Clone)]
struct ProbeInstruments {
    duration: Histogram<f64>,
    count: Counter<u64>,
}

#[derive(Default)]
struct ProbeMetricCache {
    provider: Option<Arc<dyn opentelemetry::metrics::MeterProvider + Send + Sync>>,
    instruments: Option<ProbeInstruments>,
}

fn probe_instruments() -> ProbeInstruments {
    let provider = global::meter_provider();
    let cache = PROBE_METRICS.get_or_init(|| Mutex::new(ProbeMetricCache::default()));
    let mut guard = match cache.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            warn!("probe metric lock poisoned; continuing with cached instruments");
            poisoned.into_inner()
        }
    };

    if guard
        .provider
        .as_ref()
        .is_some_and(|current| Arc::ptr_eq(current, &provider))
        && let Some(instruments) = &guard.instruments
    {
        return instruments.clone();
    }

    let meter = provider.meter(METER_NAME);
    let instruments = ProbeInstruments {
        duration: meter
            .f64_histogram(PROBE_DURATION_METRIC_NAME)
            .with_unit("s")
            .with_description("Duration of structured discovery probes by outcome")
            .build(),
        count: meter
            .u64_counter(PROBE_COUNT_METRIC_NAME)
            .with_description("Count of structured discovery probes by outcome")
            .build(),
    };

    guard.provider = Some(provider);
    guard.instruments = Some(instruments.clone());

    instruments
}

impl ProbeStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Success => "success",
            Self::Miss => "miss",
            Self::Timeout => "timeout",
            Self::Error => "error",
        }
    }
}
