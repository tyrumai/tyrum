use once_cell::sync::Lazy;
use opentelemetry::{KeyValue, global, metrics::Counter};

static REQUEST_COUNTER: Lazy<Counter<u64>> = Lazy::new(|| {
    global::meter("tyrum-api")
        .u64_counter("tyrum_api_http_requests_total")
        .with_description("Number of HTTP requests processed by the Tyrum API service")
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
