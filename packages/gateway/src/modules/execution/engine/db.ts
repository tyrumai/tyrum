export { parsePlanIdFromTriggerJson } from "@tyrum/runtime-execution";
import { DEFAULT_WORKSPACE_KEY, WorkspaceKey } from "@tyrum/contracts";

export function normalizeWorkspaceKey(input: string | undefined): string {
  const trimmed = input?.trim();
  if (!trimmed) return DEFAULT_WORKSPACE_KEY;
  const parsed = WorkspaceKey.safeParse(trimmed);
  return parsed.success ? parsed.data : DEFAULT_WORKSPACE_KEY;
}
