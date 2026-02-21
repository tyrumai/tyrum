# Architecture Gap Closure — State

**Last updated**: 2026-02-21T08:55:00Z
**Git HEAD**: 0ace604 (feat/gap-closure-p0) + uncommitted device-identity crypto + state files

## Docs Ingested (40 files)

docs/architecture/index.md, docs/architecture/gateway/index.md,
docs/architecture/protocol/handshake.md, docs/architecture/protocol/index.md,
docs/architecture/protocol/requests-responses.md, docs/architecture/protocol/events.md,
docs/architecture/agent-loop.md, docs/architecture/agent.md,
docs/architecture/artifacts.md, docs/architecture/automation.md,
docs/architecture/capabilities.md, docs/architecture/contracts.md,
docs/architecture/execution-engine.md, docs/architecture/identity.md,
docs/architecture/memory.md, docs/architecture/node.md,
docs/architecture/playbooks.md, docs/architecture/plugins.md,
docs/architecture/scaling-ha.md, docs/architecture/skills.md,
docs/architecture/workspace.md, docs/architecture/approvals.md,
docs/architecture/auth.md, docs/architecture/channels.md,
docs/architecture/client.md, docs/architecture/context-compaction.md,
docs/architecture/glossary.md, docs/architecture/markdown-formatting.md,
docs/architecture/messages-sessions.md, docs/architecture/models.md,
docs/architecture/multi-agent-routing.md, docs/architecture/observability.md,
docs/architecture/policy-overrides.md, docs/architecture/presence.md,
docs/architecture/sandbox-policy.md, docs/architecture/secrets.md,
docs/architecture/sessions-lanes.md, docs/architecture/slash-commands.md,
docs/architecture/system-prompt.md, docs/architecture/tools.md

## ARI Summary

| Status | Count |
|--------|-------|
| Implemented | 108 |
| Partially Implemented | 34 |
| Missing | 17 |
| **Total** | **159** |

## Active Backlog (ordered by priority)

- [x] PLAN-a1b2c3d4: Device identity Ed25519 verification (STUB → real crypto) **DONE this run**
- [ ] PLAN-e5f6a7b8: Policy condition evaluation in bundle.ts
- [ ] PLAN-c9d0e1f2: Context report per run
- [ ] PLAN-a3b4c5d6: Compaction/pruning implementation
- [ ] PLAN-e7f8a9b0: Snapshot export/import
- [ ] PLAN-c1d2e3f4: JSON Schema export from Zod schemas
- [ ] PLAN-a5b6c7d8: Plugin runtime (code loading + lifecycle hooks)
- [ ] PLAN-e9f0a1b2: Provider quota polling
- [ ] PLAN-c3d4e5f6: Client UI timeline + approval queue (SPA evolution)
- [ ] PLAN-a7b8c9d0: Typing modes implementation
- [ ] PLAN-e1f2a3b4: Queue overflow handling with observability

## Open Questions / Blockers

1. ~~Device identity encoding~~: RESOLVED — implemented base32(sha256(pubkey)) with "tyrum-" prefix.
2. Plugin runtime scope: Is code execution needed now, or is manifest-only acceptable for MVP?
3. Client UI direction: Evolve server-rendered /app or replace with SPA?

## Safety Check

- All changes are on `feat/gap-closure-p0` branch (not main)
- Feature flags gate all new runtime behavior (default-off for risky features)
- No database migration rollback needed (all additive ALTER TABLE + CREATE TABLE)
- Tests: 1308 pass, 0 fail (1297 prior + 11 new device-identity tests)
- Typecheck: Only pre-existing errors (runtime.ts, engine.ts, runner.ts, secret.ts)
