# ADR 0004: Artifact metadata, fetch authorization, and events

- Status: Accepted
- Date: 2026-02-21

## Context

Target architecture requires:

- durable artifact metadata in the StateStore (not only blob storage)
- controlled artifact fetch APIs with authz + redaction boundaries
- artifact lifecycle events (`artifact.created`, `artifact.attached`)

Current repo has an artifact blob store (filesystem/S3) and stores artifact refs in some attempt records, but there is no dedicated execution artifact fetch API and no artifact events.

## Decision

1. Persist artifact metadata in the StateStore as an index:
   - artifact id, kind, created_at, sha256, size, mime type
   - linkage to execution scope (run/step/attempt) when applicable
2. Introduce a gateway artifact fetch route:
   - requires gateway auth token
   - authorizes access by durable linkage (must be referenced by an execution attempt, or other durable scope)
   - returns bytes via the configured ArtifactStore (FS/S3)
3. Emit `artifact.created` and `artifact.attached` events through the outbox.

## Rationale

- Operators need auditable, identity-bound access to evidence artifacts.
- Indexing enables listing and export without scanning blob storage.
- Events enable UI timelines without polling.

## Consequences

- Additive DB tables/migrations for artifact index.
- Execution executors must record artifact refs with linkage.

## Rollout / rollback

- Rollout: add index + write path first; add fetch API behind a feature flag.
- Rollback: disable fetch API flag; keep index additive and unused.

