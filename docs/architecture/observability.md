# Observability (Context, Usage, and Audit)

Tyrum is designed so operators can answer: “what happened, why, and what did it cost?” without guessing.

## Core surfaces

### Status

`/status` (and equivalent UI panels) show:

- active model/provider and selected auth profile
- model catalog freshness (source version, cache age, last refresh status)
- session key + lane, run state, and queue depth
- context window utilization (estimated + last-run measured)
- sandbox/policy mode, sandbox hardening profile, and whether elevated execution is available
- OAuth profile health (expiry, refresh state, cooldown/disable reasons when present)

### Context inspection

`/context list` and `/context detail` expose a “context report” for the last run:

- system prompt sections and sizes
- injected workspace files (raw vs injected, truncation markers)
- skills list overhead
- **tool schema overhead** (largest tool contracts and their sizes)
- recent conversation history size and tool-result contributions

Context reports are generated deterministically by the gateway and persisted alongside the run so “what the model saw” is inspectable after the fact.

### Usage and cost

`/usage` surfaces two complementary views:

- **Local accounting:** tokens/time attributed to runs/steps/attempts (source of truth for budgets and approvals).
- **Provider usage:** provider-reported quota/usage windows when a provider exposes a usage endpoint and credentials allow access.

Usage is scoped to the current session by default, with agent-wide and tenant-wide rollups available in operator clients. Platform-wide rollups are restricted to platform administration.

Architecture notes:

- `GET /usage` returns a deployment rollup across all locally-accounted execution attempts.
- `GET /usage?key=<sessionKey>` returns a session rollup (all lanes/runs for a single session key).
- `GET /usage?agent_key=<agentKey>` returns an agent rollup (all session keys for a single agent).
- `GET /usage?run_id=<runId>` returns a per-run rollup (debugging / drilldown).

## Events, logs, and evidence

Tyrum emits typed events for:

- approvals requested/resolved
- policy overrides created/revoked/expired
- runs/steps lifecycle and retries
- policy decisions (allow/deny/require-approval + reasons + snapshot references)
- artifacts created/attached/fetched
- model/provider selection, auth rotation, and fallback decisions

Durable logs include stable ids (`run_id`, `step_id`, `attempt_id`, `approval_id`, `policy_override_id`, `artifact_id`, `policy_snapshot_id`) so operators can correlate UI, DB records, and exported bundles.

## Provider quota polling

When enabled, Tyrum queries provider usage endpoints using the active auth profile:

- polling is rate-limited and cached
- failures are non-fatal and reported as structured status fields
- results are never treated as authoritative billing records; they are operator guidance

Provider polling respects policy: usage endpoints are only queried for allowed providers/profiles and never with raw secret values in model context.
