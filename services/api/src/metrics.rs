use once_cell::sync::Lazy;
use opentelemetry::{KeyValue, global, metrics::Counter};

static REQUEST_COUNTER: Lazy<Counter<u64>> = Lazy::new(|| {
    global::meter("tyrum-api")
        .u64_counter("tyrum_api_http_requests_total")
        .with_description("Number of HTTP requests processed by the Tyrum API service")
        .build()
});

static CACHE_HIT_COUNTER: Lazy<Counter<u64>> = Lazy::new(|| {
    global::meter("tyrum-api")
        .u64_counter("tyrum_api_cache_hits_total")
        .with_description("Number of cache hits for Tyrum API capability lookups")
        .build()
});

static CACHE_MISS_COUNTER: Lazy<Counter<u64>> = Lazy::new(|| {
    global::meter("tyrum-api")
        .u64_counter("tyrum_api_cache_misses_total")
        .with_description("Number of cache misses for Tyrum API capability lookups")
        .build()
});

pub fn record_http_request(method: &'static str, route: &'static str, status: u16) {
    REQUEST_COUNTER.add(
        1,
        &[
            KeyValue::new("http.method", method),
            KeyValue::new("http.route", route),
            KeyValue::new("http.status_code", status as i64),
        ],
    );
}

#[derive(Clone, Copy, Debug)]
pub enum CacheKind {
    Schema,
    Cost,
}

impl CacheKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Schema => "schema",
            Self::Cost => "cost",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum CacheMissStatus {
    Miss,
    Unavailable,
}

impl CacheMissStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Miss => "miss",
            Self::Unavailable => "unavailable",
        }
    }
}

pub fn record_cache_hit(kind: CacheKind) {
    CACHE_HIT_COUNTER.add(1, &[KeyValue::new("cache.kind", kind.as_str())]);
    test::increment_hit(kind);
}

pub fn record_cache_miss(kind: CacheKind, status: CacheMissStatus) {
    CACHE_MISS_COUNTER.add(
        1,
        &[
            KeyValue::new("cache.kind", kind.as_str()),
            KeyValue::new("status", status.as_str()),
        ],
    );
    test::increment_miss(kind, status);
}

pub mod test {
    use super::{CacheKind, CacheMissStatus};
    use once_cell::sync::Lazy;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[cfg_attr(not(test), allow(dead_code))]
    #[derive(Default)]
    struct CacheCounters {
        schema_hits: AtomicU64,
        cost_hits: AtomicU64,
        schema_miss: AtomicU64,
        schema_unavailable: AtomicU64,
        cost_miss: AtomicU64,
        cost_unavailable: AtomicU64,
    }

    static COUNTERS: Lazy<CacheCounters> = Lazy::new(CacheCounters::default);

    #[cfg_attr(not(test), allow(dead_code))]
    #[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
    pub struct Snapshot {
        pub schema_hits: u64,
        pub schema_miss: u64,
        pub schema_unavailable: u64,
        pub cost_hits: u64,
        pub cost_miss: u64,
        pub cost_unavailable: u64,
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn reset() {
        COUNTERS.schema_hits.store(0, Ordering::Relaxed);
        COUNTERS.cost_hits.store(0, Ordering::Relaxed);
        COUNTERS.schema_miss.store(0, Ordering::Relaxed);
        COUNTERS.schema_unavailable.store(0, Ordering::Relaxed);
        COUNTERS.cost_miss.store(0, Ordering::Relaxed);
        COUNTERS.cost_unavailable.store(0, Ordering::Relaxed);
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn snapshot() -> Snapshot {
        Snapshot {
            schema_hits: COUNTERS.schema_hits.load(Ordering::Relaxed),
            schema_miss: COUNTERS.schema_miss.load(Ordering::Relaxed),
            schema_unavailable: COUNTERS.schema_unavailable.load(Ordering::Relaxed),
            cost_hits: COUNTERS.cost_hits.load(Ordering::Relaxed),
            cost_miss: COUNTERS.cost_miss.load(Ordering::Relaxed),
            cost_unavailable: COUNTERS.cost_unavailable.load(Ordering::Relaxed),
        }
    }

    pub(super) fn increment_hit(kind: CacheKind) {
        match kind {
            CacheKind::Schema => {
                COUNTERS.schema_hits.fetch_add(1, Ordering::Relaxed);
            }
            CacheKind::Cost => {
                COUNTERS.cost_hits.fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    pub(super) fn increment_miss(kind: CacheKind, status: CacheMissStatus) {
        match (kind, status) {
            (CacheKind::Schema, CacheMissStatus::Miss) => {
                COUNTERS.schema_miss.fetch_add(1, Ordering::Relaxed);
            }
            (CacheKind::Schema, CacheMissStatus::Unavailable) => {
                COUNTERS.schema_unavailable.fetch_add(1, Ordering::Relaxed);
            }
            (CacheKind::Cost, CacheMissStatus::Miss) => {
                COUNTERS.cost_miss.fetch_add(1, Ordering::Relaxed);
            }
            (CacheKind::Cost, CacheMissStatus::Unavailable) => {
                COUNTERS.cost_unavailable.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}
