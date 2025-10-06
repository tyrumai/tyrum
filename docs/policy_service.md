# Policy Check Service Skeleton

The policy check service provides the constitutional guardrails described in `docs/product_concept_v1.md` for spend, PII, and legal reviews. The current milestone exposes a stateless HTTP API with static rules to unblock downstream integrations and testing.

## Endpoints
- `POST /policy/check` – Evaluates a request across spend, PII, and legal guardrails and returns structured rule decisions plus an overall outcome.
- `GET /healthz` – Returns `{ "status": "ok" }` for container health checks.

The planner service consumes `POST /policy/check` via its async client. Configure the planner with `POLICY_GATE_URL` (defaults provided by `docker-compose.yml`) so it can locate the deployed policy service.

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
  }
}
```

All sections are optional; when context is missing the service escalates the corresponding rule so that planners can request confirmation from the user.

## Static Rule Set
- **Spend:**
  - Auto-approve up to `user_limit_minor_units` (defaults to 100.00 in currency minor units).
  - Escalate when the amount exceeds the user limit but remains under the hard ceiling (500.00).
  - Deny when the amount exceeds the hard ceiling.
- **PII:**
  - Deny when `biometric` or `government_id` data is present.
  - Escalate when `financial` or `health` data is present.
  - Approve otherwise (including basic contact or location metadata).
- **Legal:**
  - Deny when `prohibited_content` is present.
  - Escalate for `requires_review`, `export_controlled`, or `terms_unknown` flags.
  - Approve when no flags (or only `other`) are supplied.

The overall `decision` is `deny` if any rule denies, `escalate` if any rule escalates, and `approve` otherwise.

## Sample Interaction
```json
// Request
{
  "request_id": "example-123",
  "spend": { "amount_minor_units": 8750, "currency": "EUR" },
  "pii": { "categories": ["basic_contact"] },
  "legal": { "flags": [] }
}

// Response
{
  "decision": "approve",
  "rules": [
    {
      "rule": "spend_limit",
      "outcome": "approve",
      "detail": "Amount EUR 87.50 within auto-approval limit EUR 100.00."
    },
    {
      "rule": "pii_guardrail",
      "outcome": "approve",
      "detail": "PII categories acceptable for automated handling: basic_contact."
    },
    {
      "rule": "legal_compliance",
      "outcome": "approve",
      "detail": "No legal flags raised."
    }
  ]
}
```

Future milestones will replace the static thresholds with learned policy models and wire the service to shared policy definitions under `shared/`.
