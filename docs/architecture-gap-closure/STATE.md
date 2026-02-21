# Architecture Gap Closure — State

**Last updated**: 2026-02-21T10:45:00Z
**Git HEAD**: 7df2167 (feat/gap-closure-p0)

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
| Implemented | 129 |
| Partially Implemented | 25 |
| Missing | 5 |
| **Total** | **159** |

## Active Backlog (ordered by priority)

- [x] PLAN-a1b2c3d4: Device identity Ed25519 verification (STUB → real crypto) **DONE**
- [x] PLAN-9babdeb8: Secret resolution policy gate + audit **DONE**
- [x] PLAN-e5f6a7b8: Policy condition evaluation in bundle.ts **DONE**
- [x] PLAN-c9d0e1f2: Context report per run (schema + DAL + routes) **DONE run 2**
- [x] PLAN-e7f8a9b0: Snapshot export (export done, import stubbed 501) **DONE run 2**
- [x] PLAN-e1f2a3b4: Queue overflow handling with observability **DONE run 2**
- [x] PLAN-a7b8c9d0: Typing modes schema + config **DONE run 2**
- [x] PLAN-c1d2e3f4: JSON Schema export (z.toJSONSchema native, /schemas route) **DONE run 3**
- [x] PLAN-e9f0a1b2: Provider model catalog (three-tier, models.dev, env detection) **DONE run 3**
- [x] PLAN-a3b4c5d6: Session compaction (LLM-based, preserve_recent, schema+DAL+runtime) **DONE run 3**
- [x] PLAN-a5b6c7d8: Plugin runtime (Zod manifest, lifecycle hooks, code loading, security) **DONE run 3**
- [x] PLAN-c3d4e5f6: Client SPA scaffold (React 19 + Vite, gateway serving, feature flag) **DONE run 3**

## Open Questions / Blockers

1. ~~Device identity encoding~~: RESOLVED — implemented base32(sha256(pubkey)) with "tyrum-" prefix.
2. ~~Plugin runtime scope~~: RESOLVED — both manifest + code execution implemented for MVP.
3. ~~Client UI direction~~: RESOLVED — SPA scaffold created, server-rendered kept as fallback.
4. ~~Compaction~~: RESOLVED — LLM-based compaction integrated into finalizeTurn.
5. ~~Provider catalog~~: RESOLVED — three-tier cascade (cache/network/snapshot) from models.dev.

## Remaining Work (future PRs)

- SPA page-by-page migration (10 pages from server-rendered web-ui.ts)
- Snapshot import endpoint (currently stubbed 501)
- Cost tracking integration with model catalog
- Plugin marketplace / discovery

## Safety Check

- All changes are on `feat/gap-closure-p0` branch (not main)
- Feature flags gate all new runtime behavior:
  - `TYRUM_SESSION_COMPACTION` (default ON, opt-out)
  - `TYRUM_PLUGINS` (default OFF, opt-in)
  - `TYRUM_SPA_UI` (default OFF, opt-in)
- No database migration rollback needed (all additive ALTER TABLE + CREATE TABLE)
- Tests: 1358 pass, 0 fail (1332 prior + 26 new across 5 features in run 3)
- Typecheck: Only pre-existing errors (engine.ts, runner.ts, secret.ts, policy-v2.ts)

## Implementation Journal

### Run 1 (prior)
| Commit | Feature | Tests Added |
|--------|---------|-------------|
| (prior) | Device identity Ed25519 | N/A |
| (prior) | Secret resolution policy gate | N/A |

### Run 2
| Commit | Feature | Tests Added |
|--------|---------|-------------|
| d9ad66f | Policy condition evaluation | 5 |
| 5b03e19 | Context report schema + DAL + routes | 5 |
| 6f1296a | Snapshot export route | 5 |
| ade7eda | Queue overflow handling | 3 |
| addb970 | Typing modes schema | 6 |

### Run 3
| Commit | Feature | Tests Added |
|--------|---------|-------------|
| a38a0c4 | JSON Schema export (z.toJSONSchema, /schemas route) | 4 |
| 70af55f | Provider model catalog (three-tier, models.dev) | 5 |
| 843313a | Session compaction (LLM + schema + DAL) | 7 |
| 83e9f10 | Plugin runtime (Zod manifest, lifecycle, code loading) | 8 |
| 7df2167 | Client SPA scaffold (React 19 + Vite) | 3 |
