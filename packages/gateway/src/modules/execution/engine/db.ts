import { DEFAULT_WORKSPACE_KEY, WorkspaceKey } from "@tyrum/contracts";

export function parsePlanIdFromTriggerJson(triggerJson: string): string | undefined {
  try {
    const parsed = JSON.parse(triggerJson) as unknown;
    if (parsed && typeof parsed === "object") {
      const metadata = (parsed as Record<string, unknown>)["metadata"];
      if (metadata && typeof metadata === "object") {
        const planId = (metadata as Record<string, unknown>)["plan_id"];
        if (typeof planId === "string" && planId.trim().length > 0) {
          return planId;
        }
      }
    }
  } catch (err) {
    // Intentional: caller treats invalid JSON as missing metadata.
    void err;
  }
  return undefined;
}

export function normalizeWorkspaceKey(input: string | undefined): string {
  const trimmed = input?.trim();
  if (!trimmed) return DEFAULT_WORKSPACE_KEY;
  const parsed = WorkspaceKey.safeParse(trimmed);
  return parsed.success ? parsed.data : DEFAULT_WORKSPACE_KEY;
}
