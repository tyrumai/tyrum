/**
 * Typed event emitter for the gateway.
 *
 * Wraps mitt to provide a strongly-typed publish/subscribe bus
 * used by the planner orchestrator and other gateway subsystems.
 */

import type { Emitter } from "mitt";

// mitt's CJS type declarations lack a .d.mts, so under Node16 +
// verbatimModuleSyntax the default import is typed as the module
// namespace rather than the factory function.  We import the
// namespace and extract the default at runtime.
import * as mittNs from "mitt";

// At runtime the namespace may carry the factory as `.default`
// (ESM wrapper) or be the factory itself (CJS interop).  Handle both.
const mitt = (typeof mittNs.default === "function" ? mittNs.default : mittNs) as unknown as <
  T extends Record<string, unknown>,
>() => Emitter<T>;

export type GatewayEvents = {
  "plan:completed": { planId: string; stepsExecuted: number };
  "plan:failed": { planId: string; reason: string };
  "plan:escalated": { planId: string; stepIndex: number };
  "watcher:fired": { watcherId: number; planId: string; triggerType: string };
};

export type EventBus = Emitter<GatewayEvents>;

export function createEventBus(): EventBus {
  return mitt<GatewayEvents>();
}
