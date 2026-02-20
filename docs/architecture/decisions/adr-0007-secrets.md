# ADR-0007: Secrets provider defaults and secret handling

Status:

Accepted (2026-02-19)

## Context

Tyrum’s invariant is **secrets by handle**: raw secret values must not enter model context or durable logs (see [`docs/architecture/secrets.md`](../secrets.md)).

The schemas already define secret handles and provider kinds (`env|file|keychain`) in `@tyrum/schemas` (`packages/schemas/src/secret.ts`).

The gateway currently implements:

- `EnvSecretProvider` (no persistence)
- `FileSecretProvider` (AES-256-GCM encrypted file)

Desktop UX requires OS-native keychain integration. Enterprise deployments need a safe default that works with Kubernetes Secrets.
## Decision

1. **Default providers by tier**:

   - **Desktop**: OS **keychain** provider.
   - **Kubernetes/enterprise**: **env** provider (Kubernetes Secret → env), with optional external secret manager integrations later.
   - **Single-host/compose**: encrypted **file** provider as a fallback (volume-mounted).

2. **API**: implement rotate semantics and basic scoping/permissions (policy + approvals + audit), without full enterprise RBAC initially.

3. **Resolution/injection**: resolve secrets **on the executor host that needs them**:

   - workers resolve secrets for server-side steps
   - nodes resolve secrets for node-executed UI automation steps

4. **Redaction**: implement **centralized redaction** at persistence and egress boundaries (DB writes, artifacts, outbox payloads, UI rendering). Per-tool redaction is supplemental.
## Consequences

- Secrets must be handled as high-risk data throughout the pipeline; debugging modes must still redact.
- The executor environment becomes a trust boundary and must be policy-gated.
