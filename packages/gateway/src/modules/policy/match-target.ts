import { posix as pathPosix } from "node:path";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeToken(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeFsPath(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) return "";

  const slashNormalized = trimmed.replace(/\\/g, "/");
  const isAbsolute = /^(?:[a-zA-Z]:\/|\/)/.test(slashNormalized);

  const base = isAbsolute ? slashNormalized : slashNormalized.replace(/^\.\/+/, "");
  const normalized = pathPosix.normalize(base);
  if (normalized === ".") return "";
  return isAbsolute ? normalized : normalized.replace(/^\.\/+/, "");
}

function normalizeMcpToolId(rawToolId: string): string {
  const parts = rawToolId
    .trim()
    .split(".")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) return "mcp";
  if (parts.length === 1) return parts[0]!;

  const [prefix, server, ...toolParts] = parts;
  if (prefix !== "mcp") return rawToolId.trim();
  if (!server) return "mcp";
  if (toolParts.length === 0) return `mcp.${server}`;
  return `mcp.${server}.${toolParts.join(".")}`;
}

function isMessagingToolClass(toolId: string): boolean {
  const channelSendPrefix = "tool.channel.send";
  return (
    toolId.startsWith("tool.messaging.") ||
    toolId.startsWith("tool.message.") ||
    toolId === channelSendPrefix ||
    toolId.startsWith(`${channelSendPrefix}.`)
  );
}

function canonicalizeMessagingTarget(toolId: string, parsed: Record<string, unknown> | null): string {
  const action = toolId.endsWith(".send")
    ? "send"
    : normalizeToken(toolId.split(".").at(-1)) ?? "send";

  const connector =
    normalizeToken(parsed?.["connector"]) ??
    normalizeToken(parsed?.["channel"]) ??
    normalizeToken(parsed?.["source"]) ??
    normalizeToken(parsed?.["provider"]);
  const account =
    normalizeToken(parsed?.["account_id"]) ??
    normalizeToken(parsed?.["account"]) ??
    normalizeToken(parsed?.["workspace_id"]);
  const destination =
    normalizeToken(parsed?.["destination_id"]) ??
    normalizeToken(parsed?.["recipient_id"]) ??
    normalizeToken(parsed?.["thread_id"]) ??
    normalizeToken(parsed?.["channel_id"]) ??
    normalizeToken(parsed?.["conversation_id"]);

  if (connector && account && destination) {
    return `${action}:${connector}:${account}:${destination}`;
  }
  if (connector && destination) {
    return `${action}:${connector}:${destination}`;
  }

  return `${action}:${toolId}`;
}

export function canonicalizeToolMatchTarget(toolId: string, args: unknown): string {
  const normalizedToolId = toolId.trim();
  const parsed = asRecord(args);

  if (normalizedToolId === "tool.exec") {
    const command = normalizeToken(parsed?.["command"]);
    return command ? collapseWhitespace(command) : "";
  }

  if (normalizedToolId === "tool.http.fetch") {
    const url = normalizeToken(parsed?.["url"]);
    if (!url) return "";
    const q = url.indexOf("?");
    const safe = q === -1 ? url : url.slice(0, q);
    return safe.trim();
  }

  if (normalizedToolId.startsWith("tool.fs.")) {
    const operation = normalizeToken(normalizedToolId.slice("tool.fs.".length));
    const rawPath = normalizeToken(parsed?.["path"]) ?? "";
    const canonicalPath = normalizeFsPath(rawPath);
    if (!operation) return canonicalPath;
    return `${operation}:${canonicalPath}`;
  }

  if (normalizedToolId === "tool.node.dispatch") {
    const capability = normalizeToken(parsed?.["capability"]) ?? "";
    const action = normalizeToken(parsed?.["action"]) ?? "";
    return `capability:${capability};action:${action}`;
  }

  if (normalizedToolId.startsWith("mcp.")) {
    return normalizeMcpToolId(normalizedToolId);
  }

  if (isMessagingToolClass(normalizedToolId)) {
    return canonicalizeMessagingTarget(normalizedToolId, parsed);
  }

  return normalizedToolId;
}
