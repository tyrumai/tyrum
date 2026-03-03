import { posix as pathPosix, win32 as pathWin32 } from "node:path";
import {
  ActionPrimitiveKind,
  descriptorIdForClientCapability,
  requiredCapability,
} from "@tyrum/schemas";

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

function normalizeFsPath(rawPath: string, workspaceRoot?: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) return "";

  const slashNormalized = trimmed.replace(/\\/g, "/");
  const isWindowsAbsolute = /^[a-zA-Z]:\//.test(slashNormalized);
  const isPosixAbsolute = slashNormalized.startsWith("/");
  const isAbsolute = isWindowsAbsolute || isPosixAbsolute;

  let candidate = slashNormalized;
  if (isAbsolute) {
    const root = workspaceRoot?.trim()?.replace(/\\/g, "/");
    if (!root) return "";

    const rootIsWindowsAbsolute = /^[a-zA-Z]:\//.test(root);
    const rootIsPosixAbsolute = root.startsWith("/");

    if (isPosixAbsolute && rootIsPosixAbsolute) {
      const rel = pathPosix.relative(
        pathPosix.normalize(root),
        pathPosix.normalize(slashNormalized),
      );
      candidate = rel.length === 0 ? "." : rel;
    } else if (isWindowsAbsolute && rootIsWindowsAbsolute) {
      const rel = pathWin32.relative(
        pathWin32.normalize(root),
        pathWin32.normalize(slashNormalized),
      );
      const relSlash = rel.replace(/\\/g, "/");
      candidate = relSlash.length === 0 ? "." : relSlash;
    } else {
      return "";
    }

    // Reject absolute targets or cross-drive paths that can't be made workspace-relative.
    if (/^(?:[a-zA-Z]:\/|\/)/.test(candidate)) return "";
  }

  candidate = candidate.replace(/^\.\/+/, "");
  const normalized = pathPosix.normalize(candidate);
  if (normalized === ".") return ".";
  if (normalized.startsWith("/")) return "";
  if (normalized.split("/").includes("..")) return "";
  return normalized.replace(/^\.\/+/, "");
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

function canonicalizeMessagingTarget(
  toolId: string,
  parsed: Record<string, unknown> | null,
): string {
  const action = toolId.endsWith(".send")
    ? "send"
    : (normalizeToken(toolId.split(".").at(-1)) ?? "send");

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

type DesktopDispatchOp = "snapshot" | "query" | "act" | "wait_for" | "unknown";
type DesktopActSubtype = "ui" | "mouse" | "keyboard" | "unknown";
type BrowserDispatchOp =
  | "geolocation.get"
  | "camera.capture_photo"
  | "microphone.record"
  | "unknown";

function normalizeDesktopDispatchOpRaw(parsed: Record<string, unknown> | null): string | undefined {
  let current = parsed;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    const op = normalizeToken(current["op"]);
    if (op) return op;
    current = asRecord(current["args"]);
  }
  return undefined;
}

function canonicalizeDesktopDispatchOp(parsed: Record<string, unknown> | null): {
  op: DesktopDispatchOp;
  actSubtype?: DesktopActSubtype;
} {
  const opRaw = normalizeDesktopDispatchOpRaw(parsed);
  if (!opRaw) return { op: "unknown" };

  switch (opRaw) {
    case "screenshot":
      return { op: "snapshot" };
    case "snapshot":
    case "query":
    case "wait_for":
      return { op: opRaw };
    case "mouse":
      return { op: "act", actSubtype: "mouse" };
    case "keyboard":
      return { op: "act", actSubtype: "keyboard" };
    case "act":
      return { op: "act", actSubtype: "ui" };
    default:
      return { op: "unknown" };
  }
}

function normalizeBrowserDispatchOpRaw(parsed: Record<string, unknown> | null): string | undefined {
  let current = parsed;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    const op = normalizeToken(current["op"]);
    if (op) return op;
    current = asRecord(current["args"]);
  }
  return undefined;
}

function canonicalizeBrowserDispatchOp(parsed: Record<string, unknown> | null): BrowserDispatchOp {
  const opRaw = normalizeBrowserDispatchOpRaw(parsed);
  if (!opRaw) return "unknown";

  switch (opRaw) {
    case "geolocation.get":
    case "camera.capture_photo":
    case "microphone.record":
      return opRaw;
    default:
      return "unknown";
  }
}

export function canonicalizeNodeDispatchMatchTarget(
  actionKind: ActionPrimitiveKind,
  actionArgs: unknown,
): string {
  const required = requiredCapability(actionKind);
  const descriptorId = required ? descriptorIdForClientCapability(required) : "";

  let target = `capability:${descriptorId};action:${actionKind}`;

  if (required === "desktop") {
    const parsed = asRecord(actionArgs);
    const { op, actSubtype } = canonicalizeDesktopDispatchOp(parsed);
    target += `;op:${op}`;
    if (op === "act") {
      target += `;act:${actSubtype ?? "unknown"}`;
    }
  }

  if (required === "browser") {
    const parsed = asRecord(actionArgs);
    const op = canonicalizeBrowserDispatchOp(parsed);
    target += `;op:${op}`;
  }

  return target;
}

export function canonicalizeToolMatchTarget(
  toolId: string,
  args: unknown,
  workspaceRoot?: string,
): string {
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
    const h = url.indexOf("#");
    let end = url.length;
    if (q !== -1) end = Math.min(end, q);
    if (h !== -1) end = Math.min(end, h);
    return url.slice(0, end).trim();
  }

  if (normalizedToolId.startsWith("tool.fs.")) {
    const operation = normalizeToken(normalizedToolId.slice("tool.fs.".length));
    const rawPath = normalizeToken(parsed?.["path"]) ?? "";
    const canonicalPath = normalizeFsPath(rawPath, workspaceRoot);
    if (!operation) return canonicalPath;
    return `${operation}:${canonicalPath}`;
  }

  if (normalizedToolId === "tool.node.dispatch") {
    const actionToken = normalizeToken(parsed?.["action"]);
    if (!actionToken) return "capability:;action:";

    const parsedAction = ActionPrimitiveKind.safeParse(actionToken);
    if (!parsedAction.success) return "capability:;action:";

    return canonicalizeNodeDispatchMatchTarget(parsedAction.data, parsed?.["args"]);
  }

  if (normalizedToolId.startsWith("mcp.")) {
    return normalizeMcpToolId(normalizedToolId);
  }

  if (isMessagingToolClass(normalizedToolId)) {
    return canonicalizeMessagingTarget(normalizedToolId, parsed);
  }

  return normalizedToolId;
}
