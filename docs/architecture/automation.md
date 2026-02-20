# Automation

Automation lets Tyrum act on schedules and triggers while keeping behavior observable and policy-gated.

## Primitives

- **Hooks:** small scripts that run on gateway lifecycle events (for example session start/stop, reset, command events).
- **Webhooks:** an HTTP endpoint for external triggers (scoped and authenticated).
- **Cron jobs:** scheduled tasks with their own lane/session context.
- **Heartbeat:** a periodic run in the main session that batches multiple checks and follow-ups.

## When to use heartbeat vs cron

- Use **heartbeat** when the agent should be context-aware and prioritize across multiple signals inside the main session.
- Use **cron** for independent, narrow tasks that should run on a fixed schedule.

## Safety expectations

- Automation must be idempotent where possible.
- Emit events for triggers, actions taken, and outcomes.
- Apply the same policy and approval gates as interactive runs.

## Scheduler safety (DB-leases)

Automation triggers use DB-leases stored in the StateStore:

- **Lease acquisition:** one scheduler instance owns a time-bounded lease for a trigger/schedule shard.
- **Renewal + takeover:** leases are renewed periodically; on expiry, another instance can take over.
- **Durable dedupe:** each firing should have a durable unique id so downstream enqueue/execution can dedupe under retries.
