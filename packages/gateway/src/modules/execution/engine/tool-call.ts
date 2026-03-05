import type { ActionPrimitive as ActionPrimitiveT } from "@tyrum/schemas";
import { canonicalizeToolMatchTarget } from "../../policy/match-target.js";

export function toolCallFromAction(action: ActionPrimitiveT): {
  toolId: string;
  matchTarget: string;
  url?: string;
} {
  const args = action.args as unknown;
  const rec: Record<string, unknown> =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};

  if (action.type === "CLI") {
    const cmd = typeof rec["cmd"] === "string" ? rec["cmd"].trim() : "";
    const argv = Array.isArray(rec["args"])
      ? (rec["args"] as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    const command = [cmd, ...argv]
      .filter((t) => t.trim().length > 0)
      .join(" ")
      .trim();
    const matchTarget = canonicalizeToolMatchTarget("tool.exec", { command });
    return { toolId: "tool.exec", matchTarget };
  }

  if (action.type === "Http") {
    const url = typeof rec["url"] === "string" ? rec["url"].trim() : "";
    const matchTarget = canonicalizeToolMatchTarget("tool.http.fetch", { url });
    return { toolId: "tool.http.fetch", matchTarget, url: url.length > 0 ? url : undefined };
  }

  const toolId = `action.${action.type}`;
  const matchTarget = canonicalizeToolMatchTarget(toolId, rec);
  return { toolId, matchTarget };
}
