# ADR-0008: Artifact storage, retention, and export

Status:

Accepted (2026-02-19)

## Context

Tyrum requires evidence artifacts (screenshots, diffs, logs, HTTP traces) for auditability and postconditions. `@tyrum/schemas` already defines `ArtifactRef` and `artifact://…` URIs (`packages/schemas/src/artifact.ts`), but the storage location/retention story is an open gap.

Deployments range from desktop (local FS) to HA (multiple workers/edges).

## Decision

1. Implement a **pluggable artifact store interface**.

2. Provide two baseline implementations:

   - **Filesystem** store (default): local path or mounted volume.
   - **S3-compatible object store** (optional): recommended for HA deployments.

3. Persist artifact **metadata** (refs, size, sha256, labels) in the StateStore; raw bytes live in the artifact store.

4. Define retention and export as explicit policies (per deployment, with defaults) and provide export bundles that preserve:

   - references
   - hashes
   - minimal indexes needed to replay/inspect runs
## Consequences

- HA deployments should avoid relying on shared POSIX volumes; object storage is the recommended HA default.
- Artifact access becomes part of authorization policy (who can fetch which artifacts).
