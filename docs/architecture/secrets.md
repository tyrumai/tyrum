# Secrets

Secrets are a first-class architecture concept in Tyrum. The system is designed so that **the model never receives raw secret values** (passwords, API keys, tokens, card numbers).

Instead, secrets are managed by a **secret provider** and referenced via **secret handles**.

## Requirements

- Keep raw secrets out of model context and out of logs by default.
- Make secret access explicit, scoped, auditable, and revocable.
- Support multiple secret backends without changing the core gateway.

## Core concepts

### Secret provider

An out-of-process component responsible for storing and retrieving secrets (for example OS keychain, encrypted local store, or a password manager integration). The gateway communicates with the secret provider through a typed interface.

### Secret handle

An opaque reference to a stored secret. Handles are the only representation of secrets that should appear in:

- plans and workflows
- approvals
- persisted state
- audit logs

## Provider selection

Deployments use different default providers:

- **Desktop:** OS keychain provider.
- **Kubernetes:** environment-backed provider (for example a secret injected into environment variables).
- **Single host (non-keychain):** encrypted file-backed provider (volume-mounted).

## Access model

- Tools and capability providers that need credentials receive a **secret handle**, not a secret value.
- The gateway (or a trusted executor) resolves the handle at the **last responsible moment** and injects the secret into the execution context.
- Resolution must be **policy-gated** and **audited** (who requested, why, which scope).

## Rotation and revocation

Secret handles support rotation:

- rotate creates a new secret version and updates the handle mapping
- revoke invalidates access and forces failures in dependent steps until updated

For provider credentials stored as **auth profiles**, rotation/revocation must propagate to dependent execution:

- rotating a handle updates any auth profiles that reference it to use the new handle
- revoking a handle disables any auth profiles that reference it

## Cluster notes

In a single-host deployment, secret resolution can be local (for example OS keychain, encrypted local store, or environment variables). In multi-process and clustered deployments, secret handling must still preserve the same invariant: **raw secret values are never exposed to the model and are never persisted to the StateStore**.

That implies one of the following patterns:

- **Shared secret provider:** any process that executes steps (workers, trusted executors) can resolve secret handles via a provider reachable over a trusted channel.
- **Gateway-mediated resolution:** only the gateway resolves handles and injects secrets into a trusted execution context (for example a paired node) without persisting the raw value.

## Redaction and logging

- Raw secrets must never be written to the database, artifacts, or logs.
- Tool outputs and error messages must be redacted before being persisted or shown to clients.
- Debug/verbose modes must still redact secrets.

Redaction is enforced at persistence and egress boundaries:

- before DB writes and outbox/event payloads
- before artifact persistence
- before rendering outputs in operator clients

## Typical secret types

- Channel connector tokens (Telegram bot token, webhook secrets)
- OAuth refresh tokens / API keys
- Web session cookies (stored with explicit expiry metadata)
- Payment instruments (only if explicitly enabled by the operator and supported by policy)

## Provider credentials and auth profiles

Model-provider credentials (API keys and OAuth tokens) are represented as:

- secret handles stored in the secret provider, and
- auth profile metadata scoped to an agent (profile id, provider, expiry, labels)

Auth profiles are used for deterministic credential selection, rotation, and multi-account routing without exposing raw secrets to the model.

Details: [Provider Auth and Onboarding](./auth.md).

## Workflow and approval integration

- Workflows may reference secret handles as parameters.
- Any step that requires resolving a secret handle should be eligible for approval gating depending on risk and configured policy.

### Policy matching

Secret resolution is policy-gated via `PolicyBundle.secrets`. Policy matching uses **secret scopes** formatted as:

- `<provider>:<scope>` (examples: `env:MY_API_KEY`, `file:oauth:openai:agent-1:access`)

When a tool call or workflow step includes one or more secret handles, the gateway evaluates the resolved scopes against policy and enforces:

- `deny` → do not resolve secrets; execution is blocked.
- `require_approval` → pause and request operator approval before resolving secrets.
