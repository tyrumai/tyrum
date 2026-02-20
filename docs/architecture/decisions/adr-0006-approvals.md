# ADR-0006: Approvals model, APIs, and events

Status:

Accepted (2026-02-19)

## Context

Approvals are Tyrum’s durable gating mechanism for risky actions (see [`docs/architecture/approvals.md`](../approvals.md)).

The repository currently has:

- Approval contracts in `@tyrum/schemas` (`packages/schemas/src/approval.ts`).
- A SQLite `approvals` table and DAL keyed by `plan_id + step_index` (see `packages/gateway/migrations/sqlite/001_init.sql`, `packages/gateway/src/modules/approval/dal.ts`).
- Web UI routes to list/resolve approvals (`packages/gateway/src/routes/web-ui.ts`, `packages/gateway/src/routes/approval.ts`).

Enterprise deployments require multi-client correctness, HA-safe state transitions, and real-time updates.
## Decision

1. **API surface**: approvals are exposed via **both HTTP and WebSocket** APIs:

   - HTTP for automation/CLI and operational tooling.
   - WS requests/responses + events for real-time operator clients.

2. **Scoping**: approvals are primarily scoped using `ApprovalScope` (run/step identifiers), treating legacy `plan_id` as transitional metadata.

3. **Events**: approval lifecycle changes (`requested`, `resolved`, `expired`) are emitted via the **durable outbox** with polling fallback.

4. **Notifications**: the control panel is the primary UX; optional connector notifications (Telegram/Slack/email/etc.) may deep-link back to approval details.
## Consequences

- The approval state transition `pending → approved|denied|expired` must be atomic and idempotent.
- Operator clients must dedupe at-least-once events.
