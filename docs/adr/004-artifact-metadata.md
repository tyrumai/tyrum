# ADR-004: Artifact Metadata

**Status**: Accepted
**Date**: 2026-02-20

## Context

Artifacts are stored as blobs in the filesystem or S3 via `ArtifactStore`
(`modules/artifact/store.ts`). The store handles put/get of raw bytes and produces
`ArtifactRef` records, but there is no durable metadata in the state store (SQLite
or Postgres). The execution engine records artifact references in attempt rows, but
there is no dedicated table for querying, filtering, or auditing artifacts. There
is also no access-controlled fetch API for execution artifacts; only canvas
artifacts are served via `/canvas/*`.

The gap analysis (ARI-009) identifies this as high risk for auditability because
artifact metadata must survive blob store migrations and support discovery,
redaction, and access control.

## Decision

Add an `artifact_metadata` table to the state store with the following columns:

| Column | Type | Purpose |
|---|---|---|
| `artifact_id` | TEXT PK | UUID, matches blob store key |
| `run_id` | TEXT | Execution run that produced the artifact |
| `step_id` | TEXT | Step within the run |
| `attempt_id` | TEXT | Specific attempt (supports retries) |
| `kind` | TEXT | Artifact kind (log, screenshot, file, etc.) |
| `mime_type` | TEXT | MIME type for content negotiation |
| `size_bytes` | INTEGER | Size for quota/budget tracking |
| `sha256` | TEXT | Content hash for integrity verification |
| `labels` | TEXT | JSON array of string labels for filtering |
| `created_at` | TEXT | ISO 8601 timestamp |

**Write path**: When the execution engine (or any producer) stores a blob via
`ArtifactStore.put()`, it also inserts a row into `artifact_metadata` within the
same transaction. This ensures metadata and blob are consistent.

**Fetch API**: `GET /artifacts/:id` returns artifact metadata in response headers
and streams the blob body. Access control is enforced via the existing auth
middleware. The endpoint checks that the requesting principal has access to the
associated run.

**Redaction**: Artifacts flagged for redaction (via policy or operator action) have
their blob deleted while the metadata row is retained with a `redacted` flag. This
preserves the audit trail while removing sensitive content.

## Consequences

### Positive
- Enables audit: who produced what, when, and for which run/step.
- Supports discovery and filtering by kind, labels, run, or step.
- Content hashes enable integrity verification and deduplication.
- Metadata survives blob store migrations (e.g., FS to S3).

### Negative
- Adds a DB write per artifact, increasing write load proportionally.
- Metadata and blob consistency depends on transactional discipline in producers.
- Schema migration required for existing deployments (additive, backward compatible).

### Risks
- Orphaned metadata rows if blob storage fails after metadata insert. Mitigated
  by: writing blob first, then metadata; periodic reconciliation job.
- Large artifacts could strain the fetch endpoint. Mitigated by: streaming
  response, range request support in future iteration.
