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
