# Policy Check Service Skeleton

The policy check service provides the constitutional guardrails enforced outside the model for spend, PII, and legal/channel reviews. See the architecture docs for enforcement layering and approvals: [Sandbox and Policy](/architecture/sandbox-policy) and [Approvals](/architecture/approvals). The current milestone exposes a stateless HTTP API with static rules to unblock downstream integrations and testing.

## Endpoints

- `POST /policy/check` – Evaluates a request across spend, PII, and legal guardrails and returns structured rule decisions plus an overall outcome.
- `GET /healthz` – Returns `{ "status": "ok" }` for container health checks.

In the local-first profile, the policy check runs in-process inside `@tyrum/gateway`: the planner route calls the pure policy engine directly, while the `/policy/check` HTTP endpoint remains available for UI and integration testing.

## Request Schema

```jsonc
{
  "request_id": "optional identifier",
  "spend": {
    "amount_minor_units": 15000,
    "currency": "USD",
    "user_limit_minor_units": 12000
  },
  "pii": {
    "categories": [
      "basic_contact" | "location" | "financial" | "health" | "biometric" | "government_id" | "other"
    ]
  },
  "legal": {
    "flags": [
      "prohibited_content" | "requires_review" | "terms_unknown" | "export_controlled" | "other"
    ]
  },
  "connector": {
    "scope": "mcp://calendar"
  }
}
```

All sections are optional except fields required by each section's schema (for example `spend.amount_minor_units` when a `spend` object is present). When context is missing the service returns `require_approval` for the corresponding rule so planners can request confirmation.

- `connector.scope` – Optional; connector identifier that requires consent before activation. When omitted, the connector rule is skipped. Known trusted scopes auto-allow, while unknown scopes require approval and explicitly blocked scopes deny.

## Static Rule Set

- **Spend:**
  - Auto-allow up to `user_limit_minor_units` (defaults to 100.00 in currency minor units).
  - Require approval when the amount exceeds the user limit but remains under the hard ceiling (500.00).
  - Deny when the amount exceeds the hard ceiling.
- **PII:**
  - Deny when `biometric` or `government_id` data is present.
  - Require approval when `financial` or `health` data is present.
  - Allow otherwise (including basic contact or location metadata).
- **Legal:**
  - Deny when `prohibited_content` is present.
  - Require approval for `requires_review`, `export_controlled`, or `terms_unknown` flags.
  - Allow when no flags (or only `other`) are supplied.
- **Connector Scope:**
  - Allow when the scope matches curated MCP capabilities (`mcp://calendar`, `mcp://crm`, `mcp://email`, `mcp://files`, `mcp://support`, `mcp://tasks`).
  - Deny sensitive scopes such as `mcp://root`, `mcp://secrets`, or `mcp://admin`.
  - Require approval for any other scope or when the scope string is missing, prompting the planner to request user consent.

The overall `decision` is `deny` if any rule denies, `require_approval` if any rule requires approval, and `allow` otherwise.

## Validation & PII Handling

- Requests are validated structurally against the policy schema; no user identifier is required in the single-operator local-first profile.
- Tests live in `packages/gateway/tests/integration/policy.test.ts` and `packages/gateway/tests/integration/plan.test.ts`.

## Sample Interaction

```json
// Request
{
  "request_id": "example-123",
  "spend": { "amount_minor_units": 8750, "currency": "EUR" },
  "pii": { "categories": ["basic_contact"] },
  "legal": { "flags": [] },
  "connector": { "scope": "mcp://calendar" }
}

// Response
{
  "decision": "allow",
  "rules": [
    {
      "rule": "spend_limit",
      "outcome": "allow",
      "detail": "Amount EUR 87.50 within auto-approval limit EUR 100.00."
    },
    {
      "rule": "pii_guardrail",
      "outcome": "allow",
      "detail": "PII categories acceptable for automated handling: basic_contact."
    },
    {
      "rule": "legal_compliance",
      "outcome": "allow",
      "detail": "No legal flags raised."
    },
    {
      "rule": "connector_scope",
      "outcome": "allow",
      "detail": "Connector scope mcp://calendar already granted."
    }
  ]
}
```

Future work can replace the static thresholds (currently constants in `packages/gateway/src/modules/policy/engine.ts`) with user-configured profiles and learned policies, while keeping `@tyrum/contracts` as the shared contract.
