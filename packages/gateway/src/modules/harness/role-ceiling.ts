import { isBuiltinToolAvailableInStateMode, isToolAllowedWithDenylist } from "../agent/tools.js";
import type { HarnessRoleCeiling, MappedHarnessTool } from "./types.js";

/**
 * The harness half of the native `isRoleAllowedForTool` gate.
 *
 * Deliberately the same two checks in the same order as
 * `tool-set-builder-policy.ts`, because the policy engine treats
 * `roleAllowed === false` as an unconditional deny that no operator approval
 * and no policy override can lift. Dropping it on the harness path would turn a
 * hard refusal into an approvable prompt.
 *
 * A tool with a mapping-table entry is a Tyrum builtin, which is the class the
 * state-mode gate covers; anything unmapped (every MCP tool) is left to the
 * allow/deny lists alone, exactly as the native descriptor `source` check does.
 */
export function isHarnessToolRoleAllowed(input: {
  ceiling?: HarnessRoleCeiling;
  mapped: Pick<MappedHarnessTool, "toolId" | "mapped">;
}): boolean {
  const ceiling = input.ceiling;
  // No ceiling resolved: same answer the native gate gives with no allowlist.
  if (!ceiling?.toolAllowlist) return true;

  if (
    input.mapped.mapped &&
    !isBuiltinToolAvailableInStateMode(input.mapped.toolId, ceiling.stateMode)
  ) {
    return false;
  }
  return isToolAllowedWithDenylist(
    ceiling.toolAllowlist,
    ceiling.toolDenylist,
    input.mapped.toolId,
  );
}
