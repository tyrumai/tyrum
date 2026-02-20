# ADR-0002: StateStore backends and migration strategy

Status:

Accepted (2026-02-19)

## Context

Tyrum is **local-first** and currently uses SQLite in the gateway (see `packages/gateway/migrations/sqlite/001_init.sql` and the technology stack in the repository root `README.md`).

Enterprise/HA deployments require a shared StateStore with stronger concurrency and durability guarantees (typically Postgres). The architecture explicitly targets a “single architecture” that scales from SQLite → Postgres (see [`docs/architecture/scaling-ha.md`](../scaling-ha.md)).

SQLite and Postgres differ materially in SQL features, locking semantics, and supported extensions (for example vector search).

## Decision

1. Tyrum will support **two first-class StateStore backends**:
   - **SQLite** for desktop/single-host local-first deployments.
   - **Postgres** for multi-instance/HA deployments.

2. We will maintain **dual migration streams**:
   - `migrations/sqlite/…` (SQLite-specific SQL)
   - `migrations/postgres/…` (Postgres-specific SQL)

   The streams must remain **logically aligned** for core tables (approvals, execution, outbox, routing directory, sessions, audit).

3. We will add **schema contract tests** that validate the portability contract for core tables across both backends.

4. We will support **offline export/import** for SQLite → Postgres migration:
   - Stop the gateway.
   - Export a consistent snapshot of required tables.
   - Import into Postgres.
   - Start the Postgres-backed deployment.

## Options considered

- **Single migration stream / restricted SQL subset**: attractive but brittle; quickly blocks backend-specific optimizations and makes migrations hard to write correctly.
- **Dual migration streams + contract tests**: explicit and maintainable; keeps feature parity where it matters.
- **Migration DSL/tooling**: can work, but adds tooling complexity and lock-in early.
- **No parity / Postgres-only**: breaks the “scale up” story and creates divergent product behavior.

## Consequences

- We accept that **SQL differs** between SQLite and Postgres, but we require **behavioral parity** for core runtime invariants.
- Backend-specific features (for example vector search) must have an explicit portability story (feature-flagged, degraded mode, or backend-specific implementation).
