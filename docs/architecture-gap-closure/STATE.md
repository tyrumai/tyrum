# Architecture Gap Closure — STATE

Last updated: 2026-02-21T17:12:35Z  
Git HEAD: add8d944fb41dc49bb5c8ad4e93dd5e2347d8875

## Docs ingested (docs/architecture)

- docs/architecture/agent-loop.md
- docs/architecture/agent.md
- docs/architecture/approvals.md
- docs/architecture/artifacts.md
- docs/architecture/auth.md
- docs/architecture/automation.md
- docs/architecture/capabilities.md
- docs/architecture/channels.md
- docs/architecture/client.md
- docs/architecture/context-compaction.md
- docs/architecture/contracts.md
- docs/architecture/execution-engine.md
- docs/architecture/gateway/index.md
- docs/architecture/glossary.md
- docs/architecture/identity.md
- docs/architecture/index.md
- docs/architecture/markdown-formatting.md
- docs/architecture/memory.md
- docs/architecture/messages-sessions.md
- docs/architecture/models.md
- docs/architecture/multi-agent-routing.md
- docs/architecture/node.md
- docs/architecture/observability.md
- docs/architecture/playbooks.md
- docs/architecture/plugins.md
- docs/architecture/policy-overrides.md
- docs/architecture/presence.md
- docs/architecture/protocol/events.md
- docs/architecture/protocol/handshake.md
- docs/architecture/protocol/index.md
- docs/architecture/protocol/requests-responses.md
- docs/architecture/sandbox-policy.md
- docs/architecture/scaling-ha.md
- docs/architecture/secrets.md
- docs/architecture/sessions-lanes.md
- docs/architecture/skills.md
- docs/architecture/slash-commands.md
- docs/architecture/system-prompt.md
- docs/architecture/tools.md
- docs/architecture/workspace.md

## ARI status summary

- Implemented: 40
- Partially Implemented: 0
- Missing: 0
- Divergent: 0
- Unknown: 0

## Active backlog (ordered)

- None

## Completed (recent)

- [x] PLAN-ae0cedb5 — Implement queue modes for active runs (GAP-eb1f2f5e / ARI-e49fa872)
- [x] PLAN-bf69726d — Implement provider usage polling (GAP-7a2a473f / ARI-ded1b7fa)
- [x] PLAN-7633ec69 — Implement model fallback chain (GAP-0af53ac4 / ARI-9c8232b4)
- [x] PLAN-f75ba306 — Enforce per-agent isolation in StateStore queries (GAP-09465ece / ARI-77a5cb85)
- [x] PLAN-1f662dcc — Persist artifact metadata and add fetch route (GAP-1d667109 / ARI-5772b95c)
- [x] PLAN-912486d7 — Implement policy overrides (storage + evaluation) (GAP-61ad5e4c / ARI-8b1efb1c)
- [x] PLAN-83cbd7a5 — Support approve-always approvals (GAP-689f289c / ARI-878e8a8e)
- [x] PLAN-d6af6ee3 — Add suggested_overrides to approvals (GAP-56e29bd0 / ARI-d0e169d0)
- [x] PLAN-ad74615d — Propagate provenance tags end-to-end (GAP-f1f7f78d / ARI-08c4e108)
- [x] PLAN-1dfd5021 — Support ? wildcard in policy globs (GAP-241c37b8 / ARI-e6ac01f2)
- [x] PLAN-afa8916b — Fix outbox poller at-least-once semantics (GAP-84ea1396 / ARI-bed2870e)
- [x] PLAN-66147833 — Harden event delivery and dedupe by event_id (GAP-51a1363e / ARI-7d56f36b)

## Open questions / blockers

- Confirm intended fine-grained artifact authorization semantics (policy snapshot / sensitivity / agent scoping) beyond the current “admin token required” baseline.

## Safety check (risks, flags, rollback)

- Risky changes since last update:
  - Policy wildcard `?` now matches a single character (previously literal). Low risk; covered by unit tests.
  - OutboxPoller now acks consumer cursors after processing (no ack-on-throw), improving durability but potentially wedging delivery if a systematic exception occurs (should be rare; now logs errors).
  - `@tyrum/client` now deduplicates events by `event_id` (bounded in-memory). Low risk.
  - Approvals now support approve-always and can create durable policy overrides; override evaluation is deny-sticky and only relaxes `require_approval → allow`. High risk (security-sensitive) but covered by unit + integration tests.
  - Agent runtime home is now agent-scoped (`TYRUM_HOME/agents/<agent_id>` by default) and session ids are agent-namespaced; tests updated. Medium risk (path + id changes).
  - Provenance tags are promoted across tool calls and surfaced as `provenance_sources` on agent turns; channel sends use derived provenance for action policy. Medium risk (may tighten approvals when provenance rules exist).
  - Artifact metadata is now persisted durably and artifacts can be fetched through the gateway via an authenticated route. Medium risk (new API surface + DB table); covered by unit/integration tests.
  - `/usage` now supports best-effort provider polling when enabled via env; cached + rate-limited + policy-checked. Low/Medium risk (new outbound HTTP path).
  - Channel worker now supports queue modes (`collect|followup|steer|steer_backlog|interrupt`) and overflow policies (`drop_oldest|drop_newest|summarize_dropped`) for inbound messages. Medium risk (changes orchestration + drop behavior); covered by unit tests + Telegram E2E tests.
- Feature flags introduced: none recorded yet.
- New env toggles:
  - `TYRUM_PROVIDER_USAGE_POLLING=1` enables provider usage polling (default off).
  - `TYRUM_CHANNEL_QUEUE_MODE`, `TYRUM_CHANNEL_QUEUE_CAP`, `TYRUM_CHANNEL_QUEUE_OVERFLOW`, `TYRUM_CHANNEL_QUEUE_SUMMARY_MAX_CHARS` configure channel inbox behavior.
- Migration notes:
  - New DB migration `011_policy_overrides.sql` (sqlite + postgres) adds `policy_overrides` and approval resolution columns.
  - New DB migration `012_artifacts.sql` (sqlite + postgres) adds `artifacts` metadata table and indexes.
  - New DB migration `013_agent_scope_memory.sql` (sqlite + postgres) scopes durable memory tables by `agent_id`.
- Rollback notes: revert commits `4ad53ba`, `5bcdee7`, `add8d94` and re-run `pnpm typecheck && pnpm test && pnpm lint`.
- Note: This branch was rebased onto `origin/main` (commit hashes in older log entries may no longer exist on this branch; see `docs/architecture-gap-closure/LOG.md`).

## Working tree (uncommitted)

- clean
