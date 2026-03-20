import { listCapabilityCatalogEntries } from "../node/capability-catalog.js";
import type { ToolDescriptor } from "./tools.js";

type CatalogEntry = ReturnType<typeof listCapabilityCatalogEntries>[number];
type CatalogAction = CatalogEntry["actions"][number];

export type DedicatedCapabilityTool = {
  toolId: string;
  capabilityId: string;
  action: CatalogAction;
  supportsDispatchTimeout: boolean;
};

function isDedicatedCapabilityId(capabilityId: string): boolean {
  return (
    capabilityId.startsWith("tyrum.browser.") ||
    capabilityId === "tyrum.location.get" ||
    capabilityId.startsWith("tyrum.camera.") ||
    capabilityId === "tyrum.audio.record"
  );
}

function toDedicatedToolId(capabilityId: string): string {
  return `tool.${capabilityId.slice("tyrum.".length)}`;
}

function hasObjectProperty(schema: Record<string, unknown>, property: string): boolean {
  const properties = schema["properties"];
  return (
    properties !== null &&
    typeof properties === "object" &&
    !Array.isArray(properties) &&
    property in properties
  );
}

function buildInputSchema(tool: DedicatedCapabilityTool): Record<string, unknown> {
  const properties =
    tool.action.inputSchema["properties"] &&
    typeof tool.action.inputSchema["properties"] === "object" &&
    !Array.isArray(tool.action.inputSchema["properties"])
      ? { ...(tool.action.inputSchema["properties"] as Record<string, unknown>) }
      : {};

  properties["node_id"] = {
    type: "string",
    description: "Optional node id to target explicitly.",
  };
  if (tool.supportsDispatchTimeout) {
    properties["timeout_ms"] = {
      type: "number",
      description: "Optional dispatch timeout in milliseconds.",
    };
  }

  return {
    ...tool.action.inputSchema,
    type: "object",
    properties,
    required: Array.isArray(tool.action.inputSchema["required"])
      ? [...tool.action.inputSchema["required"]]
      : [],
    additionalProperties: false,
  };
}

function buildKeywords(tool: DedicatedCapabilityTool): string[] {
  const tokens = tool.capabilityId
    .replace(/^tyrum\./, "")
    .split(/[.-]/)
    .filter((token) => token.length > 0);
  return [...new Set(["node", ...tokens])];
}

function buildToolDescriptor(tool: DedicatedCapabilityTool): ToolDescriptor {
  return {
    id: tool.toolId,
    description: tool.action.description,
    effect: "state_changing",
    keywords: buildKeywords(tool),
    source: "builtin",
    family: "node",
    inputSchema: buildInputSchema(tool),
  };
}

const DEDICATED_CAPABILITY_TOOLS: readonly DedicatedCapabilityTool[] =
  listCapabilityCatalogEntries()
    .filter((entry) => isDedicatedCapabilityId(entry.descriptor.id))
    .flatMap((entry) => {
      const action = entry.actions[0];
      if (!action) {
        return [];
      }
      return [
        {
          toolId: toDedicatedToolId(entry.descriptor.id),
          capabilityId: entry.descriptor.id,
          action,
          supportsDispatchTimeout: !hasObjectProperty(action.inputSchema, "timeout_ms"),
        },
      ];
    });

const DEDICATED_CAPABILITY_TOOL_BY_ID = new Map(
  DEDICATED_CAPABILITY_TOOLS.map((tool) => [tool.toolId, tool] as const),
);

export function listDedicatedCapabilityTools(): readonly DedicatedCapabilityTool[] {
  return DEDICATED_CAPABILITY_TOOLS;
}

export function getDedicatedCapabilityTool(toolId: string): DedicatedCapabilityTool | undefined {
  return DEDICATED_CAPABILITY_TOOL_BY_ID.get(toolId.trim());
}

export function listDedicatedCapabilityToolDescriptors(): ToolDescriptor[] {
  return DEDICATED_CAPABILITY_TOOLS.map(buildToolDescriptor);
}
