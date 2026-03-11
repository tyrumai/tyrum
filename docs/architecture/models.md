# Models

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

## Configured presets and selection

Operators configure **providers** and **model presets** in the control plane:

- A provider can have multiple configured accounts.
- A model preset points to one discovered `provider/model` and applies curated options such as `reasoning_effort`.
- Built-in execution profiles can be assigned to configured presets or left unset (`None`).

At runtime, Tyrum resolves models in this order:

1. Session preset override (`/model <preset_key>`).
2. Session raw model override (legacy compatibility).
3. Execution-profile preset assignment.
4. Agent primary model.
5. Agent fallback chain.

Tyrum no longer seeds bootstrap provider accounts, model presets, or execution-profile assignments on first launch. If no configured candidate is available, runtime resolution fails closed with a configuration error instead of silently selecting a default model.

## Fallback

When a model call fails, Tyrum attempts recovery in a predictable order:

1. **Provider account rotation** within the provider (if multiple credentials are configured).
2. **Model fallback** to the next model in an explicit fallback chain.

Failures should be surfaced as structured events so clients can show what happened and why.

## Provider account selection (within a provider)

Providers can have multiple configured accounts (internally backed by **auth profiles**). These records reference secrets by handle and can represent multiple API-key or token-based accounts.

Selection behavior is deterministic:

- an account can be explicitly pinned (globally or per-session)
- otherwise Tyrum chooses a stable default order and pins the chosen profile per session
- on rate limits and transient failures, Tyrum rotates to the next eligible profile and applies cooldowns

Details: [Provider Auth and Onboarding](./auth.md) and [Secrets](./secrets.md).

## Observability

Model selection emits events that include:

- chosen `provider/model`
- chosen provider account id (redacted)
- rotations, cooldowns, and fallback decisions

Operator surfaces (`/status`, `/usage`, Configure > Providers, Configure > Models) expose the active model/provider, account state, and provider usage where available (see [Observability](./observability.md)).

`/status` also exposes `config_health`, which reports operator-facing configuration issues such as missing provider accounts, missing presets, unset execution profiles, or agents without a primary model.
