import { homedir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";

function resolveTyrumHome(): string {
  const fromEnv = process.env["TYRUM_HOME"]?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return join(homedir(), ".tyrum");
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeWorkspacePath(rawPath: string, home: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return "";
  const normalized = trimmed.replaceAll("\\", "/");
  if (!isAbsolute(normalized)) {
    return normalized;
  }

  const resolvedHome = resolve(home);
  const resolvedPath = resolve(normalized);
  const rel = relative(resolvedHome, resolvedPath);
  if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) {
    return rel.replaceAll("\\", "/");
  }

  return normalized;
}

export function computeToolMatchTarget(
  toolId: string,
  args: unknown,
  opts?: { home?: string },
): string | undefined {
  const home = opts?.home ?? resolveTyrumHome();
  const parsed = args as Record<string, unknown> | null;

  if (toolId === "tool.exec") {
    const command = typeof parsed?.["command"] === "string" ? parsed["command"] : undefined;
    if (!command) return undefined;
    return normalizeWhitespace(command.split("\n")[0] ?? "");
  }

  if (toolId === "tool.fs.read" || toolId === "tool.fs.write") {
    const rawPath = typeof parsed?.["path"] === "string" ? parsed["path"] : undefined;
    if (!rawPath) return undefined;
    const op = toolId === "tool.fs.read" ? "read" : "write";
    const normalizedPath = normalizeWorkspacePath(rawPath, home);
    if (!normalizedPath) return undefined;
    return `${op}:${normalizedPath}`;
  }

  if (toolId === "tool.http.fetch") {
    const url = typeof parsed?.["url"] === "string" ? parsed["url"] : undefined;
    if (!url) return undefined;
    try {
      const u = new URL(url);
      return u.hostname.toLowerCase();
    } catch {
      return undefined;
    }
  }

  if (toolId === "tool.node.dispatch") {
    const capability = typeof parsed?.["capability"] === "string" ? parsed["capability"] : undefined;
    const action = typeof parsed?.["action"] === "string" ? parsed["action"] : undefined;
    if (!capability || !action) return undefined;
    return `${normalizeWhitespace(capability)}:${normalizeWhitespace(action)}`;
  }

  if (toolId.startsWith("mcp.")) {
    return toolId;
  }

  return undefined;
}

export interface SuggestedPolicyOverride {
  tool_id: string;
  pattern: string;
  agent_id?: string;
  workspace_id?: string;
  match_target?: string;
}

export function suggestPolicyOverridesForToolCall(opts: {
  toolId: string;
  args: unknown;
  agentId?: string;
  workspaceId?: string;
  home?: string;
}): SuggestedPolicyOverride[] {
  const matchTarget = computeToolMatchTarget(opts.toolId, opts.args, { home: opts.home });
  if (!matchTarget) return [];

  const suggestion: SuggestedPolicyOverride = {
    tool_id: opts.toolId,
    pattern: matchTarget,
    agent_id: opts.agentId,
    workspace_id: opts.workspaceId,
    match_target: matchTarget,
  };

  return [suggestion];
}

