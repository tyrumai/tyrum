# NATS JetStream Runtime

## Overview
- Provides durable event storage and delivery semantics for watcher workloads (calendar conflicts, VIP follow-ups, delivery ETA slips per product concept §15.1).
- Backed by the `nats:2.10-alpine` container wired into `infra/docker-compose.yml` with JetStream health probes enabled.

## Local & CI Resources
- Allocate **≥512 MiB memory** and **≥128 MiB disk** for the JetStream container. CI runners provision 768 MiB headroom to absorb bursts during integration tests.
- The default compose service exposes ports `4222` (client) and `8222` (monitoring). Ports are published to the host for local debuggability.
- Health check (`wget --spider http://localhost:8222/healthz?js-enabled`) is required for compose and CI orchestration; keep the monitoring port open.

## Configuration
- Core environment variables consumed by the watcher service:
  - `WATCHERS_JETSTREAM_URL` (required): e.g. `nats://nats:4222`.
  - `WATCHERS_JETSTREAM_STREAM` (optional, default `watchers_events`).
  - `WATCHERS_JETSTREAM_SUBJECT_PREFIX` (optional, default `watchers.events`).
  - `WATCHERS_JETSTREAM_SAMPLE_CONSUMER` (optional durable name for round-trip checks).
  - `WATCHERS_JETSTREAM_CLIENT_NAME` (optional client label surfaced in NATS monitoring).
- Compose keeps the service unauthenticated for now; local overrides can be applied by exporting the variables above before invoking binaries that depend on the watcher client.

## Security & Follow-Up
- Authentication and authorization are **TBD**. Future work will introduce NATS credentials (user/pass or nkeys) issued via the existing secret manager; do not embed secrets in the repository.
- When credentials land, update this document and the watcher service JetStream config loader to require them, and ensure policy gate reviews the new outbound domain list.
