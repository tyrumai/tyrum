# Telemetry Pipeline

The local compose stack now exposes a full OpenTelemetry pipeline so developers can inspect traces, metrics, and logs while building against the M0 services. The collector is the single ingestion point for OTLP traffic and fans out data to Prometheus, Tempo, and Loki for storage/visualisation.

## Stack Overview
- **OpenTelemetry Collector (`otel-collector`)** – receives OTLP gRPC/HTTP traffic on ports `4317`/`4318`, exports metrics to Prometheus, traces to Tempo, and logs to Loki.
- **Prometheus (`prometheus`)** – scrapes collector metrics on `9464` and serves charts at `http://localhost:9090`.
- **Tempo (`tempo`)** – stores traces from the collector and is reachable at `http://localhost:3200` (query through Grafana).
- **Loki (`loki`)** – stores OTLP logs streaming from the collector and exposes the API at `http://localhost:3100`.
- **Grafana (`grafana`)** – pre-provisioned with Prometheus, Loki, and Tempo data sources and served on `http://localhost:3001` with credentials `admin` / `tyrum`.

## Running the Observability Services
```bash
# rebuild images to pick up collector config changes
cd infra
docker compose up --build otel-collector prometheus tempo loki grafana
```

All other application services automatically depend on the collector and export OTLP gRPC data using the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable (`http://otel-collector:4317` in Docker, `http://localhost:4317` when running binaries directly).

## Validating Data Flow
1. Start the full stack (`docker compose up --build`) and wait for Grafana to report "Server is ready" in the logs.
2. Exercise the services to emit telemetry:
   ```bash
   curl -s http://localhost:8080/healthz > /dev/null
   curl -s http://localhost:8081/policy/check -H 'Content-Type: application/json' -d '{}'
   ```
3. Open Grafana (`http://localhost:3001`, `admin` / `tyrum`):
   - **Explore → Tempo** to view spans `api.index`, `api.health`, and `policy.check` grouped by `service.name`.
   - **Explore → Loki** to see structured logs from the `tyrum-api` and `tyrum-policy` services.
   - **Explore → Prometheus** or the Prometheus UI to query `tyrum_api_http_requests_total` and `tyrum_policy_decisions_total` metrics.

## Notes
- The collector configuration lives at `infra/otel-collector-config.yaml`; adjust exporters here if additional backends are required.
- Grafana provisioning (`infra/grafana/provisioning/datasources/datasources.yaml`) declares the default data sources so new dashboards can be saved immediately.
- Local binaries (outside Docker) will honour `OTEL_EXPORTER_OTLP_ENDPOINT`; copy `config/local.env.example` to `config/local.env` and source it before running `cargo run`.
