# Model Gateway & Routing Plan

## Overview

Tyrum must orchestrate multiple LLM backends:

- **Local inference** via vLLM for lightweight, latency-sensitive prompts (e.g., ≤20B models we can host in the lab).
- **Frontier APIs** (OpenAI, OpenRouter, or other SaaS providers) for complex reasoning or premium modalities.

To keep the planner architecture simple, we will introduce a **model gateway** that exposes a unified OpenAI-compatible surface and routes each request to the appropriate backend based on configurable policy.

## Responsibilities

1. Present a single OpenAI-compatible endpoint (`/v1/*`) to internal services.
2. Resolve the requested `model` to a configured backend target.
3. Inject per-backend authentication (API keys, organizational headers).
4. Enforce guardrails (timeout ceilings, token limits, cost ceilings).
5. Surface structured errors so the planner can degrade gracefully.

## Routing Rules

Routing decisions are driven by configuration. Each model entry declares:

- **Target** (`local_vllm`, `openai`, `openrouter`, etc.).
- **Upstream endpoint** (base URL + path).
- **Auth profile** (reference to stored credentials).
- **Capability flags** (supports streaming, vision, audio, etc.).
- **Budget guardrails** (max tokens, cost model).

Requests that specify an unknown model are rejected with a `404 model_not_found` response to avoid silent misroutes.

## Configuration Sketch

Configurations live in `config/model_gateway.yml` (mirrors the pattern used by other infra services):

```yaml
# config/model_gateway.yml
defaults:
  timeout_ms: 20000
  max_total_tokens: 4096
  retry:
    attempts: 2
    backoff_ms: 200

auth_profiles:
  local_vllm: {}
  openai_prod:
    type: bearer
    env: OPENAI_API_KEY
  openrouter_prod:
    type: bearer
    env: OPENROUTER_API_KEY

models:
  tyrum-stub-8b:
    target: local_vllm
    endpoint: http://vllm-gateway:8000/v1
    capabilities: [text]

  frontier-gpt-4o:
    target: openai
    endpoint: https://api.openai.com/v1
    auth_profile: openai_prod
    capabilities: [text, vision, audio]
    cost_ceiling_usd: 0.40

  frontier-deepthink-r1:
    target: openrouter
    endpoint: https://openrouter.ai/api/v1
    auth_profile: openrouter_prod
    capabilities: [text]
    max_total_tokens: 8192
```

> **Note:** Secrets never live in the file—only references to environment variables or secret manager paths per the repo-wide security guidance.

## Request Flow

1. Planner issues an OpenAI-compatible request to the gateway with the desired `model`.
2. Gateway resolves the model configuration and determines backend.
3. Gateway rewrites or proxies the request to the backend, attaching auth headers.
4. Response is normalized to OpenAI schema and returned to the caller.

## Streaming responses

- Requests that include `stream: true` are proxied using Server-Sent Events (`text/event-stream`). The gateway forwards each upstream chunk without buffering, so downstream consumers (e.g., voice TTS) can react to partial completions.
- When upstreams return streaming responses by default (e.g., long-running inference), the gateway automatically switches to streaming mode even if the client did not request it explicitly.
- Streaming works for any configured backend that supports OpenAI-compatible SSE (local vLLM or third-party APIs).

## Health & Observability

- The gateway exposes `/healthz` for docker-compose readiness.
- Per-backend latency and error metrics are tagged and exported to OTEL.
- Audit logs include the selected backend, token usage, and cost attribution.

## Next Steps

1. Scaffold the gateway service (likely a lightweight Rust or Python proxy).
2. Add it to `infra/docker-compose.yml` with local vLLM + dummy upstream stubs for integration tests.
3. Extend planner configuration to list only gateway-exposed model IDs.
4. Document operational runbooks once implementation lands.

This document should be updated when we land the implementation (service code, compose entry, deployment manifests) and when new upstream providers are onboarded.
