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
    const matchTarget = canonicalizeToolMatchTarget("bash", { command });
    return { toolId: "bash", matchTarget };
  }

  if (action.type === "Http") {
    const url = typeof rec["url"] === "string" ? rec["url"].trim() : "";
    const matchTarget = canonicalizeToolMatchTarget("webfetch", { url });
    return { toolId: "webfetch", matchTarget, url: url.length > 0 ? url : undefined };
  }

  if (action.type === "Mcp") {
    const serverId = typeof rec["server_id"] === "string" ? rec["server_id"].trim() : "";
    const toolName = typeof rec["tool_name"] === "string" ? rec["tool_name"].trim() : "";
    const input =
      rec["input"] && typeof rec["input"] === "object" && !Array.isArray(rec["input"])
        ? (rec["input"] as Record<string, unknown>)
        : {};

    if (serverId === "exa") {
      if (toolName === "web_search_exa") {
        const query = typeof input["query"] === "string" ? input["query"] : "";
        return {
          toolId: "websearch",
          matchTarget: canonicalizeToolMatchTarget("websearch", { query }),
        };
      }
      if (toolName === "get_code_context_exa") {
        const query = typeof input["query"] === "string" ? input["query"] : "";
        return {
          toolId: "codesearch",
          matchTarget: canonicalizeToolMatchTarget("codesearch", { query }),
        };
      }
      if (toolName === "crawling_exa") {
        const url = typeof input["url"] === "string" ? input["url"].trim() : "";
        return {
          toolId: "webfetch",
          matchTarget: canonicalizeToolMatchTarget("webfetch", { url }),
          url: url.length > 0 ? url : undefined,
        };
      }
    }

    const toolId = serverId && toolName ? `mcp.${serverId}.${toolName}` : "mcp";
    return { toolId, matchTarget: canonicalizeToolMatchTarget(toolId, input) };
  }

  const toolId = `action.${action.type}`;
  const matchTarget = canonicalizeToolMatchTarget(toolId, rec);
  return { toolId, matchTarget };
}
