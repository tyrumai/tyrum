# Models

## Status

- **Status:** Implemented

Tyrum identifies models as `provider/model`.

## Model catalog

Tyrum uses a shared **model catalog** to describe:

- available providers and their models
- capability metadata (for example context window and modality)
- how to instantiate a provider implementation

The catalog is loaded using a three-tier strategy:

1. Fetch the current catalog from `models.dev`.
2. Use a cached copy stored in the StateStore.
3. Fall back to a catalog snapshot distributed with Tyrum.

Catalog refresh is lease-controlled to avoid stampedes in multi-replica deployments.

## Model identifiers

- The provider and model id are parsed by splitting on the first `/`.
- If the model id itself contains `/` (common with aggregator style ids), include the provider prefix.

Examples:

- `openai/gpt-4.1`
- `openrouter/moonshotai/kimi-k2`

## Provider adapters

Tyrum instantiates model providers using standard provider adapters referenced by the model catalog (for example, provider packages in the Vercel AI SDK ecosystem). Tyrum does not maintain a separate built-in mapping table of provider names to implementations.

## Selection and fallback

When a model call fails, Tyrum attempts recovery in a predictable order:

1. **Auth profile rotation** within the provider (if multiple credentials are configured).
2. **Model fallback** to the next model in an explicit fallback chain.

Failures should be surfaced as structured events so clients can show what happened and why.

## Auth profile selection (within a provider)

Providers can have multiple **auth profiles** (API keys and/or OAuth profiles). Profiles are scoped per agent, reference secrets by handle, and can represent multiple accounts.

Selection behavior is deterministic:

- a profile can be explicitly pinned (globally or per-session)
- otherwise Tyrum chooses a stable default order and pins the chosen profile per session
- on rate limits and transient failures, Tyrum rotates to the next eligible profile and applies cooldowns

Details: [Provider Auth and Onboarding](./auth.md) and [Secrets](./secrets.md).

## Observability

Model selection emits events that include:

- chosen `provider/model`
- chosen auth profile id (redacted)
- rotations, cooldowns, and fallback decisions

Operator surfaces (`/status`, `/usage`, UI settings) expose the active model/provider, auth profile state, and provider usage where available (see [Observability](./observability.md)).
