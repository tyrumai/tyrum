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
