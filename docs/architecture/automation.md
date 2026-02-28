# Automation

Automation lets Tyrum act on schedules and triggers while keeping behavior observable and policy-gated.

## Primitives

- **Hooks:** small scripts that run on gateway lifecycle events (for example session start/stop, reset, command events).
- **Webhooks:** an HTTP endpoint for external triggers (scoped and authenticated).
- **Cron jobs:** scheduled tasks with their own lane/session context.
- **Heartbeat:** a periodic run in the main session (lane `heartbeat`) that batches multiple checks and follow-ups.
- **WorkSignals:** durable time- or event-based triggers attached to a WorkItem/workspace that enqueue explicit follow-up work (see [Work board and delegated execution](./workboard.md)).

## When to use heartbeat vs cron

- Use **heartbeat** when the agent should be context-aware and prioritize across multiple signals inside the main session.
- Use **cron** for independent, narrow tasks that should run on a fixed schedule.
- WorkSignals can be realized as heartbeat-driven checks (context-aware) or as cron/watchers (narrow); the key invariant is that firings are durable, deduped, and policy-gated.

## Safety expectations

- Automation must be idempotent where possible.
- Emit events for triggers, actions taken, and outcomes.
- Apply the same policy and approval gates as interactive runs.
- Webhooks must be authenticated and replay-resistant (for example a signature over the request body plus timestamp/nonce), and should be rate-limited.
- Webhook secrets must be stored behind the secret provider and referenced via handles. Avoid placing secrets in URLs.
- Prefer running webhook-triggered work in a dedicated lane/session with minimal permissions.
- Hooks must be explicitly configured/allowlisted and run under the same policy/sandbox constraints as any other execution.

## Lifecycle hooks (gateway events)

Lifecycle hooks are allowlisted automation workflows that enqueue execution runs on gateway lifecycle events.

**Configuration (explicit allowlist):**

- Hooks are loaded from a configured hooks allowlist file (YAML or JSON).
- Only hooks listed in this file can run (no directory discovery by default).

Example:

```yaml
v: 1
hooks:
  - hook_key: hook:550e8400-e29b-41d4-a716-446655440000
    event: command.execute
    lane: cron
    steps:
      - type: CLI
        args:
          cmd: echo
          args: ["hello from hooks"]
```

**Supported hook events (initial set):**

- `gateway.start` — fired once per gateway process start.
- `gateway.shutdown` — fired during graceful shutdown.
- `command.execute` — fired after an operator runs a gateway command.

**Execution semantics:**

- Hooks enqueue steps into the execution engine (default lane: `cron`).
- Steps are subject to policy snapshot enforcement (`allow` / `deny` / `require_approval`) and sandbox boundaries.
- When policy requires approval, the run pauses with reason `policy` and emits an approval request.

## Scheduler safety (DB-leases)

Automation triggers use DB-leases stored in the StateStore:

- **Lease acquisition:** one scheduler instance owns a time-bounded lease for a trigger/schedule shard.
- **Renewal + takeover:** leases are renewed periodically; on expiry, another instance can take over.
- **Durable dedupe:** each firing should have a durable unique id so downstream enqueue/execution can dedupe under retries.
- **Stable identifiers:** cron/webhook/heartbeat triggers carry a durable `firing_id` and lease metadata so operators and downstream systems can correlate/replay safely (for example via execution job `trigger.metadata.firing_id`, `trigger.metadata.lease_owner`, and `trigger.metadata.lease_expires_at_ms`).
