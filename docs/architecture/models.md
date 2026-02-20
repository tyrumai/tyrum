# Models

Tyrum identifies models as `provider/model`.

## Model identifiers

- The provider and model id are parsed by splitting on the first `/`.
- If the model id itself contains `/` (common with aggregator style ids), include the provider prefix.

Examples:

- `openai/gpt-4.1`
- `openrouter/moonshotai/kimi-k2`

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
