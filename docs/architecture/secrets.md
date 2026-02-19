# Secrets

Status:

Secrets are a first-class architecture concept in Tyrum. The system is designed so that **the model never receives raw secret values** (passwords, API keys, tokens, card numbers).

Instead, secrets are managed by a **secret provider** and referenced via **secret handles**.

## Goals

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

## Access model

- Tools and capability providers that need credentials receive a **secret handle**, not a secret value.
- The gateway (or a trusted executor) resolves the handle at the **last responsible moment** and injects the secret into the execution context.
- Resolution must be **policy-gated** and **audited** (who requested, why, which scope).

## Cluster notes

In a single-host deployment, secret resolution can be local (for example OS keychain, encrypted local store, or environment variables). In multi-process and clustered deployments, secret handling must still preserve the same invariant: **raw secret values are never exposed to the model and are never persisted to the StateStore**.

That implies one of the following patterns:

- **Shared secret provider:** any process that executes steps (workers, trusted executors) can resolve secret handles via a provider reachable over a trusted channel.
- **Gateway-mediated resolution:** only the gateway resolves handles and injects secrets into a trusted execution context (for example a paired node) without persisting the raw value.

## Redaction and logging

- Raw secrets must never be written to the database, artifacts, or logs.
- Tool outputs and error messages must be redacted before being persisted or shown to clients.
- Debug/verbose modes must still redact secrets.

## Typical secret types

- Channel connector tokens (Telegram bot token, webhook secrets)
- OAuth refresh tokens / API keys
- Web session cookies (stored with explicit expiry metadata)
- Payment instruments (only if explicitly enabled by the operator and supported by policy)

## Workflow and approval integration

- Workflows may reference secret handles as parameters.
- Any step that requires resolving a secret handle should be eligible for approval gating depending on risk and configured policy.

