import { posix as pathPosix, win32 as pathWin32 } from "node:path";
import { ActionPrimitiveKind, canonicalizeToolId } from "@tyrum/schemas";

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
type ScheduleExecutionKind = "agent_turn" | "playbook" | "steps" | "unknown";

function normalizeNodeDispatchOpRaw(parsed: Record<string, unknown> | null): string | undefined {
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
  const opRaw = normalizeNodeDispatchOpRaw(parsed);
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

function canonicalizeBrowserDispatchOp(parsed: Record<string, unknown> | null): BrowserDispatchOp {
  const opRaw = normalizeNodeDispatchOpRaw(parsed);
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

function normalizeScheduleExecutionKind(
  parsed: Record<string, unknown> | null,
): ScheduleExecutionKind {
  const execution = asRecord(parsed?.["execution"]);
  const kind = normalizeToken(execution?.["kind"]);
  if (kind === "agent_turn" || kind === "playbook" || kind === "steps") {
    return kind;
  }
  return "unknown";
}

function normalizeScheduleDeliveryMode(
  parsed: Record<string, unknown> | null,
  fallbackKind?: string,
): "quiet" | "notify" | "unknown" {
  const delivery = asRecord(parsed?.["delivery"]);
  const mode = normalizeToken(delivery?.["mode"]);
  if (mode === "quiet" || mode === "notify") return mode;
  if (fallbackKind === "heartbeat") return "quiet";
  if (fallbackKind === "cron") return "notify";
  return "unknown";
}

function buildScheduleScopeTokens(parsed: Record<string, unknown> | null): string[] {
  const tokens: string[] = [];
  const agentKey = normalizeToken(parsed?.["agent_key"]);
  const workspaceKey = normalizeToken(parsed?.["workspace_key"]);
  if (agentKey) tokens.push(`agent_key:${agentKey}`);
  if (workspaceKey) tokens.push(`workspace_key:${workspaceKey}`);
  return tokens;
}

function canonicalizeScheduleCreateMatchTarget(parsed: Record<string, unknown> | null): string {
  const kind = normalizeToken(parsed?.["kind"]) ?? "unknown";
  const executionKind = normalizeScheduleExecutionKind(parsed);
  const deliveryMode = normalizeScheduleDeliveryMode(parsed, kind);
  const tokens = [
    `kind:${kind}`,
    `execution:${executionKind}`,
    `delivery:${deliveryMode}`,
    ...buildScheduleScopeTokens(parsed),
  ];

  if (executionKind === "playbook") {
    const execution = asRecord(parsed?.["execution"]);
    const playbookId = normalizeToken(execution?.["playbook_id"]) ?? "unknown";
    tokens.push(`playbook_id:${playbookId}`);
  }

  return tokens.join(";");
}

function canonicalizeScheduleUpdateMatchTarget(parsed: Record<string, unknown> | null): string {
  const scheduleId = normalizeToken(parsed?.["schedule_id"]) ?? "";
  const tokens = [`schedule_id:${scheduleId}`];
  const kind = normalizeToken(parsed?.["kind"]);
  if (kind) {
    tokens.push(`kind:${kind}`);
  }

  const execution = asRecord(parsed?.["execution"]);
  const executionKind = normalizeToken(execution?.["kind"]);
  if (executionKind === "agent_turn" || executionKind === "playbook" || executionKind === "steps") {
    tokens.push(`execution:${executionKind}`);
    if (executionKind === "playbook") {
      tokens.push(`playbook_id:${normalizeToken(execution?.["playbook_id"]) ?? "unknown"}`);
    }
  }

  const delivery = asRecord(parsed?.["delivery"]);
  const mode = normalizeToken(delivery?.["mode"]);
  if (mode === "quiet" || mode === "notify") {
    tokens.push(`delivery:${mode}`);
  }

  return tokens.join(";");
}

export function canonicalizeNodeDispatchMatchTarget(
  actionKind: ActionPrimitiveKind,
  actionArgs: unknown,
): string {
  let target = `action:${actionKind}`;

  if (actionKind === "Desktop") {
    const parsed = asRecord(actionArgs);
    const { op, actSubtype } = canonicalizeDesktopDispatchOp(parsed);
    target += `;op:${op}`;
    if (op === "act") {
      target += `;act:${actSubtype ?? "unknown"}`;
    }
  }

  if (actionKind === "Browser") {
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
  const normalizedToolId = canonicalizeToolId(toolId.trim());
  const parsed = asRecord(args);

  if (normalizedToolId === "bash") {
    const command = normalizeToken(parsed?.["command"]);
    return command ? collapseWhitespace(command) : "";
  }

  if (normalizedToolId === "webfetch") {
    const url = normalizeToken(parsed?.["url"]);
    if (!url) return "";
    const q = url.indexOf("?");
    const h = url.indexOf("#");
    let end = url.length;
    if (q !== -1) end = Math.min(end, q);
    if (h !== -1) end = Math.min(end, h);
    return url.slice(0, end).trim();
  }

  if (normalizedToolId === "memory.search") {
    return "memory.search";
  }

  if (normalizedToolId === "memory.add") {
    const kind = normalizeToken(parsed?.["kind"]) ?? "";
    const sensitivity = normalizeToken(parsed?.["sensitivity"]) ?? "private";
    return `memory.add:kind=${kind}:sensitivity=${sensitivity}`;
  }

  if (["read", "write", "edit", "apply_patch", "glob", "grep"].includes(normalizedToolId)) {
    if (normalizedToolId === "apply_patch") return "apply_patch";
    if (normalizedToolId === "glob") {
      const pattern = normalizeToken(parsed?.["pattern"]) ?? "";
      return pattern ? `glob:${pattern}` : "glob:";
    }
    if (normalizedToolId === "grep") {
      const pattern = normalizeToken(parsed?.["pattern"]) ?? "";
      return pattern ? `grep:${pattern}` : "grep:";
    }
    const canonicalOperation = ["read", "write", "edit"].includes(normalizedToolId)
      ? normalizedToolId
      : undefined;
    const rawPath = normalizeToken(parsed?.["path"]) ?? "";
    const canonicalPath = normalizeFsPath(rawPath, workspaceRoot);
    if (!canonicalOperation) return canonicalPath;
    return `${canonicalOperation}:${canonicalPath}`;
  }

  if (normalizedToolId === "tool.node.dispatch") {
    const capability = normalizeToken(parsed?.["capability"]) ?? "";
    const actionName = normalizeToken(parsed?.["action_name"]);
    if (!actionName) return `capability:${capability};action:`;

    const inferredPrimitive =
      capability === "tyrum.browser"
        ? "Browser"
        : capability === "tyrum.desktop"
          ? "Desktop"
          : actionName.startsWith("camera.") ||
              actionName.startsWith("microphone.") ||
              actionName.startsWith("geolocation.")
            ? "Browser"
            : "Desktop";
    const parsedAction = ActionPrimitiveKind.safeParse(inferredPrimitive);

    if (!parsedAction.success) return `capability:${capability};action:${actionName}`;

    const input = asRecord(parsed?.["input"]);
    const actionArgs = input ? { ...input, op: actionName } : { op: actionName };
    return `capability:${capability};${canonicalizeNodeDispatchMatchTarget(
      parsedAction.data,
      actionArgs,
    )}`;
  }

  if (normalizedToolId === "tool.automation.schedule.create") {
    return canonicalizeScheduleCreateMatchTarget(parsed);
  }

  if (normalizedToolId === "tool.automation.schedule.update") {
    return canonicalizeScheduleUpdateMatchTarget(parsed);
  }

  if (
    normalizedToolId === "tool.automation.schedule.get" ||
    normalizedToolId === "tool.automation.schedule.pause" ||
    normalizedToolId === "tool.automation.schedule.resume" ||
    normalizedToolId === "tool.automation.schedule.delete"
  ) {
    const scheduleId = normalizeToken(parsed?.["schedule_id"]) ?? "";
    return `schedule_id:${scheduleId}`;
  }

  if (normalizedToolId.startsWith("mcp.")) {
    return normalizeMcpToolId(normalizedToolId);
  }

  if (isMessagingToolClass(normalizedToolId)) {
    return canonicalizeMessagingTarget(normalizedToolId, parsed);
  }

  return normalizedToolId;
}
