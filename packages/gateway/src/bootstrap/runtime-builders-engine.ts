import { ExecutionEngine } from "../modules/execution/engine.js";
import type { GatewayBootContext } from "./runtime-shared.js";

export function createExecutionEngine(
  context: GatewayBootContext,
  options?: { includeSecrets?: boolean },
): ExecutionEngine {
  return new ExecutionEngine({
    db: context.container.db,
    redactionEngine: context.container.redactionEngine,
    secretProviderForTenant:
      options?.includeSecrets === false ? undefined : context.secretProviderForTenant,
    policyService: context.container.policyService,
    logger: context.logger,
  });
}
