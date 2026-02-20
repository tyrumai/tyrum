# Provider Auth and Onboarding

Tyrum supports multiple model providers and authentication mechanisms while preserving the invariant that raw credentials never enter model context.

## Principles

- **Secrets by handle:** credentials are stored in a secret provider and referenced via secret handles (see [Secrets](./secrets.md)).
- **Least privilege:** auth profiles are scoped per agent and gated by policy.
- **Observable and auditable:** auth changes, refreshes, and failovers emit events and are attributable to an operator identity.
- **Deterministic failover:** when calls fail, Tyrum rotates credentials and models in a predictable order (see [Models](./models.md)).

## Auth profiles

An **auth profile** is a durable record that tells Tyrum how to authenticate to a provider.

Profiles are **metadata + secret handles**:

- `profile_id` (stable; used for routing/pinning)
- `provider` (for example `openai`, `anthropic`, `openrouter`)
- `type`:
  - `api_key`
  - `oauth` (access + refresh)
  - `token` (non-refreshing bearer token)
- `secret_handles` (for example `api_key_handle`, `oauth_refresh_handle`)
- `expires_at` (when applicable)
- optional labels (`email`, `account_id`, `workspace`, `notes`)

Profiles are scoped per `agent_id`. Cross-agent sharing is deny-by-default and requires explicit policy.

## OAuth flows (subscription and multi-account)

When a provider supports OAuth, Tyrum supports interactive login and headless login:

- **Interactive (PKCE / local callback):** a local callback endpoint completes the exchange.
- **Headless (paste / device-code):** the operator pastes a code or redirect URL to complete login.

OAuth tokens are stored via the secret provider; only token **handles** are persisted in Tyrum state. Refresh is automatic:

- access tokens are refreshed under a lock
- refresh outputs overwrite the prior handles
- refresh failures are surfaced as structured events and status surfaces

Multiple accounts are represented as multiple auth profiles for the same provider (distinct `profile_id`s).

## Credential selection, pinning, and rotation

For a given provider, Tyrum selects an auth profile using:

1. An explicit configured order (if present).
2. Stored profiles for the provider (stable, deterministic ordering).

Selections are **pinned per session** to keep provider caches warm and to make behavior repeatable. The pinned profile is reused until:

- the session is reset
- the profile expires or is revoked
- the profile enters cooldown due to repeated transient failures

### Cooldowns and disabling

When a request fails, Tyrum classifies the failure and reacts predictably:

- **Rate limit / transient:** rotate to the next profile for the provider and apply a cooldown to the failing profile.
- **Auth invalid / revoked:** disable the profile until an operator re-authenticates.
- **Billing / quota exhausted:** disable the profile with a long backoff and rotate to another profile or model fallback.

Cooldown/disable state is durable and visible in the control panel and `/status`.

## Operator UX (CLI + control panel)

Tyrum exposes a small operator surface for auth lifecycle:

- Add/remove profiles (API key and OAuth).
- List profiles and their status (expiry, cooldown, disabled reason).
- Select a profile globally or per-session (pin override).
- Export a redacted auth inventory (no secret material).

All auth mutations require an authenticated operator identity and are audited.

## Integration points

Auth profiles integrate with:

- **Policy:** which providers/profiles can be used for which sessions and lanes.
- **Approvals:** high-risk auth changes (adding a privileged key, granting a broad OAuth scope) can be approval-gated.
- **Usage tracking:** provider usage endpoints are queried using the active profile and displayed in `/usage` and UI surfaces (see [Observability](./observability.md)).

