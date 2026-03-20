import { NodeId, RoutedToolExecutionMetadata } from "@tyrum/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isDedicatedRoutedToolId(toolId: string): boolean {
  return (
    toolId.startsWith("tool.desktop.") ||
    toolId.startsWith("tool.browser.") ||
    toolId === "tool.location.get" ||
    toolId.startsWith("tool.camera.") ||
    toolId === "tool.audio.record" ||
    toolId === "tool.secret.copy-to-node-clipboard"
  );
}

function resolveRequestedNodeId(args: unknown): string | undefined {
  if (!isRecord(args)) {
    return undefined;
  }
  const parsed = NodeId.safeParse(args["node_id"]);
  return parsed.success ? parsed.data : undefined;
}

export function buildRoutedToolExecutionMetadata(toolId: string, args: unknown) {
  if (!isDedicatedRoutedToolId(toolId)) {
    return undefined;
  }

  const requestedNodeId = resolveRequestedNodeId(args);
  if (!requestedNodeId) {
    return undefined;
  }

  return RoutedToolExecutionMetadata.parse({
    requested_node_id: requestedNodeId,
    selected_node_id: requestedNodeId,
    selection_mode: "explicit",
  });
}

export function buildRoutedToolApprovalPromptSuffix(toolId: string, args: unknown): string {
  const routing = buildRoutedToolExecutionMetadata(toolId, args);
  if (!routing || routing.selection_mode !== "explicit") {
    return "";
  }
  return ` on node '${routing.selected_node_id}'`;
}
