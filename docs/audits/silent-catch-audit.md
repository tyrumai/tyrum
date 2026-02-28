# Silent `catch {}` audit (gateway)

Categorized audit of every silent TypeScript `catch { ... }` block in `packages/gateway/src/` (i.e., catches that do not bind an error variable).

- Date: 2026-02-28
- Match rule: lines containing `catch {` (191 matches)

## Summary (191 total)

- `intentional`: 121
- `needs-logging`: 66
- `needs-rethrow`: 4
- `needs-error-response`: 0

## Review focus

- Individually reviewed: `packages/gateway/src/ws/`, `packages/gateway/src/routes/`, `packages/gateway/src/modules/execution/`, `packages/gateway/src/modules/channels/`, plus selected high-count files (e.g., `packages/gateway/src/modules/agent/runtime/agent-runtime.ts`).
- Verification: `packages/gateway/tests/unit/silent-catch-audit.test.ts` asserts this table covers every `catch {` in `packages/gateway/src/`.

## Buckets

- **intentional**: safe/expected failure (parse/validation/best-effort) where swallowing is acceptable
- **needs-logging**: should log with context (and likely bind `catch (error)`)
- **needs-rethrow**: should rethrow (or propagate) after adding context
- **needs-error-response**: should surface a structured error to the caller (HTTP/WS/step result)

## Audit

| File | Line | Category | Notes |
| --- | ---: | --- | --- |
| packages/gateway/src/index.ts | 501 | intentional | Intentional: optional file/parse/shutdown best-effort; keep behavior. |
| packages/gateway/src/index.ts | 540 | intentional | Intentional: optional file/parse/shutdown best-effort; keep behavior. |
| packages/gateway/src/index.ts | 584 | intentional | Intentional: optional file/parse/shutdown best-effort; keep behavior. |
| packages/gateway/src/index.ts | 612 | intentional | Intentional: optional file/parse/shutdown best-effort; keep behavior. |
| packages/gateway/src/index.ts | 1389 | intentional | Intentional: optional file/parse/shutdown best-effort; keep behavior. |
| packages/gateway/src/index.ts | 1430 | intentional | Intentional: optional file/parse/shutdown best-effort; keep behavior. |
| packages/gateway/src/migrate-postgres.ts | 37 | intentional | Intentional: ignore rollback errors while surfacing the original migration failure. |
| packages/gateway/src/ws/broadcast.ts | 21 | intentional | Intentional best-effort WS socket operation or malformed input handling; keep behavior (optional debug log). |
| packages/gateway/src/ws/connection-manager.ts | 165 | intentional | Intentional best-effort WS socket operation or malformed input handling; keep behavior (optional debug log). |
| packages/gateway/src/ws/connection-manager.ts | 172 | intentional | Intentional best-effort WS socket operation or malformed input handling; keep behavior (optional debug log). |
| packages/gateway/src/ws/connection-manager.ts | 175 | intentional | Intentional best-effort WS socket operation or malformed input handling; keep behavior (optional debug log). |
| packages/gateway/src/ws/pairing-approved.ts | 33 | intentional | Intentional best-effort WS socket operation or malformed input handling; keep behavior (optional debug log). |
| packages/gateway/src/utils/json.ts | 5 | intentional | Intentional safe parse fallback; keep behavior and add a brief comment explaining why the error is ignored. |
| packages/gateway/src/ws/protocol/dispatch.ts | 328 | intentional | Intentional best-effort WS socket operation or malformed input handling; keep behavior (optional debug log). |
| packages/gateway/src/ws/protocol/handler.ts | 151 | intentional | Intentional best-effort WS socket operation or malformed input handling; keep behavior (optional debug log). |
| packages/gateway/src/ws/protocol/handler.ts | 848 | intentional | Intentional best-effort WS socket operation or malformed input handling; keep behavior (optional debug log). |
| packages/gateway/src/ws/protocol/handler.ts | 1249 | intentional | Intentional best-effort WS socket operation or malformed input handling; keep behavior (optional debug log). |
| packages/gateway/src/ws/protocol/handler.ts | 2696 | intentional | Intentional best-effort WS socket operation or malformed input handling; keep behavior (optional debug log). |
| packages/gateway/src/statestore/sqlite.ts | 65 | intentional | Intentional: ignore rollback failures and surface original transaction error. |
| packages/gateway/src/statestore/postgres.ts | 120 | intentional | Intentional: ignore rollback failures and surface original transaction error. |
| packages/gateway/src/statestore/postgres.ts | 137 | intentional | Intentional: ignore rollback failures and surface original transaction error. |
| packages/gateway/src/routes/ws.ts | 104 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/ws.ts | 183 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/ws.ts | 321 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/ws.ts | 443 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/ws.ts | 542 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/ws.ts | 625 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/ws.ts | 684 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/ws.ts | 799 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/ws.ts | 822 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/modules/workboard/dal.ts | 104 | intentional | Intentional JSON/cursor parsing fallback; keep behavior. |
| packages/gateway/src/modules/workboard/dal.ts | 113 | intentional | Intentional JSON/cursor parsing fallback; keep behavior. |
| packages/gateway/src/modules/workboard/dal.ts | 142 | intentional | Intentional JSON/cursor parsing fallback; keep behavior. |
| packages/gateway/src/routes/operator-ui.ts | 16 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/operator-ui.ts | 86 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/modules/workboard/signal-scheduler.ts | 64 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/routes/auth-session.ts | 13 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/auth-session.ts | 25 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/modules/workboard/notifications.ts | 95 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/routes/workflow.ts | 87 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/usage.ts | 130 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/snapshot.ts | 236 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/pairing.ts | 34 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/memory.ts | 15 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/modules/hooks/config.ts | 12 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/routes/ingress.ts | 87 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/ingress.ts | 107 | needs-logging | Bind `error` and log enqueue failure with chat/thread/message context; keep 503 retry response. |
| packages/gateway/src/routes/ingress.ts | 168 | needs-logging | Bind `error` and log agent runtime failure with chat/thread/session context; keep user-facing fallback reply. |
| packages/gateway/src/routes/ingress.ts | 175 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/contracts.ts | 72 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/contracts.ts | 113 | needs-logging | Return 500 as now, but also bind `error` and log read/parse failures with file path + request context. |
| packages/gateway/src/routes/artifact.ts | 137 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/approval.ts | 48 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/modules/authz/http-scope-middleware.ts | 60 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/routes/routing-config.ts | 44 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/routing-config.ts | 77 | needs-logging | Bind `error` and log corrupt routing config state before returning 500 to operator. |
| packages/gateway/src/routes/policy-bundle.ts | 44 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/device-token.ts | 38 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/routes/device-token.ts | 68 | intentional | Intentional input validation or best-effort side-effect; keep behavior (optional debug log). |
| packages/gateway/src/modules/oauth/provider-registry.ts | 87 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/oauth/pending-dal.ts | 42 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/oauth/oauth-client.ts | 123 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/secret/provider.ts | 88 | intentional | Intentional: treat missing secrets store as empty; avoid swallowing corruption silently (see needs-rethrow rows). |
| packages/gateway/src/modules/secret/provider.ts | 164 | intentional | Intentional: treat missing secrets store as empty; avoid swallowing corruption silently (see needs-rethrow rows). |
| packages/gateway/src/modules/secret/provider.ts | 170 | needs-rethrow | Do not silently treat unreadable/corrupt secrets store as empty; bind `error`, log, and surface corruption (or move aside the file) so secrets are not silently lost. |
| packages/gateway/src/modules/secret/provider.ts | 271 | intentional | Intentional: treat missing secrets store as empty; avoid swallowing corruption silently (see needs-rethrow rows). |
| packages/gateway/src/modules/secret/provider.ts | 277 | needs-rethrow | Do not silently treat unreadable/corrupt secrets store as empty; bind `error`, log, and surface corruption (or move aside the file) so secrets are not silently lost. |
| packages/gateway/src/modules/presence/dal.ts | 38 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/playbook/runtime.ts | 216 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/playbook/loader.ts | 54 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/playbook/loader.ts | 62 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/plugins/registry.ts | 363 | intentional | Intentional: missing/unreadable plugin metadata or fail-closed path checks; keep behavior (logging handled elsewhere). |
| packages/gateway/src/modules/plugins/registry.ts | 455 | intentional | Intentional: missing/unreadable plugin metadata or fail-closed path checks; keep behavior (logging handled elsewhere). |
| packages/gateway/src/modules/plugins/registry.ts | 497 | intentional | Intentional: missing/unreadable plugin metadata or fail-closed path checks; keep behavior (logging handled elsewhere). |
| packages/gateway/src/modules/plugins/registry.ts | 729 | intentional | Intentional: missing/unreadable plugin metadata or fail-closed path checks; keep behavior (logging handled elsewhere). |
| packages/gateway/src/modules/plugins/registry.ts | 737 | intentional | Intentional: missing/unreadable plugin metadata or fail-closed path checks; keep behavior (logging handled elsewhere). |
| packages/gateway/src/modules/plugins/registry.ts | 769 | intentional | Intentional: missing/unreadable plugin metadata or fail-closed path checks; keep behavior (logging handled elsewhere). |
| packages/gateway/src/modules/plugins/registry.ts | 786 | intentional | Intentional: missing/unreadable plugin metadata or fail-closed path checks; keep behavior (logging handled elsewhere). |
| packages/gateway/src/modules/plugins/registry.ts | 827 | intentional | Intentional: missing/unreadable plugin metadata or fail-closed path checks; keep behavior (logging handled elsewhere). |
| packages/gateway/src/modules/plugins/installer.ts | 34 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/plugins/lockfile.ts | 28 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/node/pairing-dal.ts | 39 | intentional | Intentional JSON parsing fallback for stored fields; keep behavior. |
| packages/gateway/src/modules/node/pairing-dal.ts | 52 | intentional | Intentional JSON parsing fallback for stored fields; keep behavior. |
| packages/gateway/src/modules/node/pairing-dal.ts | 66 | intentional | Intentional JSON parsing fallback for stored fields; keep behavior. |
| packages/gateway/src/modules/canvas/dal.ts | 34 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/auth/middleware.ts | 37 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/auth/token-store.ts | 79 | intentional | Intentional token parse/IO fallback; keep behavior. |
| packages/gateway/src/modules/auth/token-store.ts | 147 | intentional | Intentional token parse/IO fallback; keep behavior. |
| packages/gateway/src/modules/auth/token-store.ts | 329 | intentional | Intentional token parse/IO fallback; keep behavior. |
| packages/gateway/src/modules/auth/token-store.ts | 498 | intentional | Intentional token parse/IO fallback; keep behavior. |
| packages/gateway/src/modules/models/auth-profile-dal.ts | 55 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/auth/client-ip.ts | 271 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/markdown/telegram.ts | 103 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/markdown/telegram.ts | 400 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/audit/hash-chain.ts | 20 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/context/report-dal.ts | 38 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/approval/dal.ts | 65 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/commands/dispatcher.ts | 150 | intentional | Intentional parse/validation fallback; keep behavior. |
| packages/gateway/src/modules/commands/dispatcher.ts | 187 | intentional | Intentional parse/validation fallback; keep behavior. |
| packages/gateway/src/modules/commands/dispatcher.ts | 335 | intentional | Intentional parse/validation fallback; keep behavior. |
| packages/gateway/src/modules/commands/dispatcher.ts | 358 | intentional | Intentional parse/validation fallback; keep behavior. |
| packages/gateway/src/modules/commands/dispatcher.ts | 374 | intentional | Intentional parse/validation fallback; keep behavior. |
| packages/gateway/src/modules/commands/dispatcher.ts | 428 | intentional | Intentional parse/validation fallback; keep behavior. |
| packages/gateway/src/modules/commands/dispatcher.ts | 513 | intentional | Intentional parse/validation fallback; keep behavior. |
| packages/gateway/src/modules/agent/tool-executor.ts | 230 | intentional | Intentional security/cleanup best-effort handling; keep behavior. |
| packages/gateway/src/modules/agent/tool-executor.ts | 272 | intentional | Intentional security/cleanup best-effort handling; keep behavior. |
| packages/gateway/src/modules/agent/tool-executor.ts | 826 | intentional | Intentional security/cleanup best-effort handling; keep behavior. |
| packages/gateway/src/modules/agent/tool-executor.ts | 832 | intentional | Intentional security/cleanup best-effort handling; keep behavior. |
| packages/gateway/src/modules/agent/tool-executor.ts | 993 | intentional | Intentional security/cleanup best-effort handling; keep behavior. |
| packages/gateway/src/modules/channels/inbox-dal.ts | 438 | intentional | Intentional best-effort channel behavior (parse/broadcast/cleanup); keep behavior (optional debug log). |
| packages/gateway/src/modules/channels/inbox-dal.ts | 768 | intentional | Intentional best-effort channel behavior (parse/broadcast/cleanup); keep behavior (optional debug log). |
| packages/gateway/src/modules/channels/telegram.ts | 354 | intentional | Intentional best-effort channel behavior (parse/broadcast/cleanup); keep behavior (optional debug log). |
| packages/gateway/src/modules/channels/telegram.ts | 1012 | intentional | Intentional best-effort channel behavior (parse/broadcast/cleanup); keep behavior (optional debug log). |
| packages/gateway/src/modules/channels/telegram.ts | 1139 | needs-logging | Bind `error` and log connector policy evaluation failure; decision already fails closed to `require_approval`. |
| packages/gateway/src/modules/channels/telegram.ts | 1223 | intentional | Intentional best-effort channel behavior (parse/broadcast/cleanup); keep behavior (optional debug log). |
| packages/gateway/src/modules/agent/home.ts | 53 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/channels/routing-config-dal.ts | 34 | intentional | Intentional best-effort channel behavior (parse/broadcast/cleanup); keep behavior (optional debug log). |
| packages/gateway/src/modules/channels/routing-config-dal.ts | 94 | intentional | Intentional best-effort channel behavior (parse/broadcast/cleanup); keep behavior (optional debug log). |
| packages/gateway/src/modules/agent/workspace.ts | 70 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/agent/workspace.ts | 127 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/channels/routing.ts | 51 | intentional | Intentional best-effort channel behavior (parse/broadcast/cleanup); keep behavior (optional debug log). |
| packages/gateway/src/modules/agent/session-dal.ts | 55 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/agent/mcp-manager.ts | 334 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/agent/mcp-manager.ts | 360 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/agent/markdown-memory.ts | 66 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/agent/loop-detection.ts | 26 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/observability/status-details.ts | 148 | intentional | Intentional status sampling fallback; keep behavior. |
| packages/gateway/src/modules/observability/status-details.ts | 198 | intentional | Intentional status sampling fallback; keep behavior. |
| packages/gateway/src/modules/observability/status-details.ts | 366 | intentional | Intentional status sampling fallback; keep behavior. |
| packages/gateway/src/modules/observability/status-details.ts | 627 | intentional | Intentional status sampling fallback; keep behavior. |
| packages/gateway/src/modules/observability/provider-usage.ts | 390 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 255 | needs-logging | Bind `error` and log policy bundle load failure; current behavior returns unknown elevated-exec availability. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 564 | intentional | Intentional: agent runtime best-effort fallback to keep turns running; add logging where diagnosis is needed. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 697 | intentional | Intentional: agent runtime best-effort fallback to keep turns running; add logging where diagnosis is needed. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 849 | intentional | Intentional: agent runtime best-effort fallback to keep turns running; add logging where diagnosis is needed. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 1324 | intentional | Intentional: agent runtime best-effort fallback to keep turns running; add logging where diagnosis is needed. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 1336 | intentional | Intentional: agent runtime best-effort fallback to keep turns running; add logging where diagnosis is needed. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 1461 | intentional | Intentional: agent runtime best-effort fallback to keep turns running; add logging where diagnosis is needed. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 1869 | intentional | Intentional: agent runtime best-effort fallback to keep turns running; add logging where diagnosis is needed. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 2205 | needs-logging | Bind `error` and log malformed `result_json`; current behavior drops the stored result for this run. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 2242 | needs-logging | Bind `error` and log semantic search failures (rate limited); current behavior returns empty hits. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 2319 | intentional | Intentional: agent runtime best-effort fallback to keep turns running; add logging where diagnosis is needed. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 2432 | needs-logging | Bind `error` and log embedding pipeline resolution failures; current behavior disables semantic search. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 2615 | intentional | Intentional: agent runtime best-effort fallback to keep turns running; add logging where diagnosis is needed. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 2820 | needs-logging | Bind `error` and log WorkBoard lookup failure for subagent execution profile; current fallback uses `explorer_ro`. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 2859 | intentional | Intentional: agent runtime best-effort fallback to keep turns running; add logging where diagnosis is needed. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 3215 | intentional | Intentional: agent runtime best-effort fallback to keep turns running; add logging where diagnosis is needed. |
| packages/gateway/src/modules/agent/runtime/agent-runtime.ts | 3670 | needs-logging | Bind `error` and log policy gating failure for side-effecting plugin tools; current behavior fails closed. |
| packages/gateway/src/modules/execution/gateway-step-executor.ts | 136 | needs-logging | Bind `error` and log invalid policy snapshot JSON; current fallback treats decision as `require_approval`. |
| packages/gateway/src/modules/execution/gateway-step-executor.ts | 152 | needs-logging | Bind `error` and log secret-provider list failure; current fallback returns raw handle IDs. |
| packages/gateway/src/modules/execution/gateway-step-executor.ts | 329 | needs-logging | Bind `error` and log malformed approval `context_json`; current fallback uses empty context. |
| packages/gateway/src/modules/execution/gateway-step-executor.ts | 612 | intentional | Intentional conservative/best-effort execution behavior (parse/cleanup/limits); keep behavior. |
| packages/gateway/src/modules/execution/gateway-step-executor.ts | 709 | needs-logging | Bind `error` and log malformed approval `context_json`; current fallback uses empty context. |
| packages/gateway/src/modules/execution/gateway-step-executor.ts | 898 | intentional | Intentional conservative/best-effort execution behavior (parse/cleanup/limits); keep behavior. |
| packages/gateway/src/modules/execution/toolrunner-step-executor.ts | 90 | intentional | Intentional conservative/best-effort execution behavior (parse/cleanup/limits); keep behavior. |
| packages/gateway/src/modules/execution/toolrunner-step-executor.ts | 96 | intentional | Intentional conservative/best-effort execution behavior (parse/cleanup/limits); keep behavior. |
| packages/gateway/src/modules/watcher/scheduler.ts | 209 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/execution/local-step-executor.ts | 102 | intentional | Intentional conservative/best-effort execution behavior (parse/cleanup/limits); keep behavior. |
| packages/gateway/src/modules/execution/local-step-executor.ts | 144 | intentional | Intentional conservative/best-effort execution behavior (parse/cleanup/limits); keep behavior. |
| packages/gateway/src/modules/execution/local-step-executor.ts | 421 | intentional | Intentional conservative/best-effort execution behavior (parse/cleanup/limits); keep behavior. |
| packages/gateway/src/modules/execution/local-step-executor.ts | 427 | intentional | Intentional conservative/best-effort execution behavior (parse/cleanup/limits); keep behavior. |
| packages/gateway/src/modules/execution/kubernetes-toolrunner-step-executor.ts | 57 | intentional | Intentional conservative/best-effort execution behavior (parse/cleanup/limits); keep behavior. |
| packages/gateway/src/modules/execution/kubernetes-toolrunner-step-executor.ts | 290 | intentional | Intentional conservative/best-effort execution behavior (parse/cleanup/limits); keep behavior. |
| packages/gateway/src/modules/policy/domain.ts | 62 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/policy/snapshot-dal.ts | 28 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/policy/service.ts | 32 | intentional | Intentional: treat missing policy files as absent; keep behavior. |
| packages/gateway/src/modules/policy/service.ts | 460 | needs-logging | Bind `error` and log deployment bundle load failure (path + reason) before falling back to the default bundle. |
| packages/gateway/src/modules/policy/service.ts | 507 | needs-logging | Bind `error` and log agent bundle load failure (path + reason) before falling back to a null bundle. |
| packages/gateway/src/modules/backplane/connection-directory.ts | 47 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/backplane/connection-directory.ts | 59 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/policy/override-dal.ts | 38 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/execution/engine/execution-engine.ts | 172 | needs-logging | Bind `error` and log secret-provider list failure; current fallback returns raw handle IDs. |
| packages/gateway/src/modules/execution/engine/execution-engine.ts | 1267 | needs-logging | Bind `error` and log invalid stored policy snapshot JSON; current behavior marks snapshot invalid and fails closed. |
| packages/gateway/src/modules/execution/engine/execution-engine.ts | 1276 | needs-rethrow | Do not swallow `action_json` parse failures; bind `error`, log, and fail the run/step with a structured error (corrupt DB state). |
| packages/gateway/src/modules/execution/engine/execution-engine.ts | 1535 | needs-rethrow | Do not swallow malformed `action_json`; bind `error`, log, and fail the run/step with a structured error (corrupt DB state). |
| packages/gateway/src/modules/execution/engine/execution-engine.ts | 2473 | needs-logging | Bind `error` and log malformed `action_json` while deciding retry eligibility; current behavior is conservative. |
| packages/gateway/src/modules/backplane/outbox-dal.ts | 28 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/execution/engine/concurrency.ts | 32 | intentional | Intentional conservative/best-effort execution behavior (parse/cleanup/limits); keep behavior. |
| packages/gateway/src/modules/execution/engine/db.ts | 15 | intentional | Intentional conservative/best-effort execution behavior (parse/cleanup/limits); keep behavior. |
| packages/gateway/src/modules/memory/vector-dal.ts | 39 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/memory/vector-dal.ts | 46 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/memory/v1-semantic-index.ts | 164 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/memory/v1-semantic-index.ts | 227 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/memory/v1-digest.ts | 60 | intentional | Intentional best-effort memory digest building; keep behavior (optional debug logs on persistent failures). |
| packages/gateway/src/modules/memory/v1-digest.ts | 281 | intentional | Intentional best-effort memory digest building; keep behavior (optional debug logs on persistent failures). |
| packages/gateway/src/modules/memory/v1-digest.ts | 291 | intentional | Intentional best-effort memory digest building; keep behavior (optional debug logs on persistent failures). |
| packages/gateway/src/modules/memory/v1-digest.ts | 362 | intentional | Intentional best-effort memory digest building; keep behavior (optional debug logs on persistent failures). |
| packages/gateway/src/modules/artifact/store.ts | 279 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/memory/v1-dal.ts | 113 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/memory/v1-dal.ts | 343 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
| packages/gateway/src/modules/discovery/strategies/capability-memory.ts | 28 | needs-logging | Change to `catch (error)` and log with context; decide whether to rethrow or return a structured error. |
