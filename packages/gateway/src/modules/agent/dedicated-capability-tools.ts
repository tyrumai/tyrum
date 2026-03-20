import { listCapabilityCatalogEntries } from "../node/capability-catalog.js";
import { toolIdForCapabilityDescriptor } from "../node/capability-tool-id.js";
import type { ToolDescriptor } from "./tools.js";

type CatalogEntry = ReturnType<typeof listCapabilityCatalogEntries>[number];
type CatalogAction = CatalogEntry["actions"][number];

export type DedicatedCapabilityTool = {
  toolId: string;
  capabilityId: string;
  action: CatalogAction;
  supportsDispatchTimeout: boolean;
};

const DEDICATED_ROUTED_TOOL_PROMPT_GUIDANCE = [
  "Pass action-specific fields directly and use node_id only when you need to target a specific node.",
  "Omit node_id when any eligible attached node can satisfy the request.",
  "Use timeout_ms only when you need to override the default dispatch timeout.",
] as const;

const DEDICATED_ROUTED_TOOL_EXAMPLES_BY_ID: ReadonlyMap<string, readonly string[]> = new Map([
  [
    "tool.browser.navigate",
    ['{"url":"https://example.com","node_id":"node_456","timeout_ms":30000}'],
  ],
  ["tool.location.get", ['{"enable_high_accuracy":true,"timeout_ms":30000}']],
  [
    "tool.camera.capture-photo",
    ['{"format":"jpeg","quality":0.9,"node_id":"node_789","timeout_ms":30000}'],
  ],
  ["tool.audio.record", ['{"duration_ms":5000,"node_id":"node_789","timeout_ms":30000}']],
]);

function isDedicatedCapabilityId(capabilityId: string): boolean {
  return (
    capabilityId.startsWith("tyrum.browser.") ||
    capabilityId === "tyrum.location.get" ||
    capabilityId.startsWith("tyrum.camera.") ||
    capabilityId === "tyrum.audio.record"
  );
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

function objectProperties(
  schema: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const properties = schema["properties"];
  if (properties === null || typeof properties !== "object" || Array.isArray(properties)) {
    return {};
  }

  const entries = Object.entries(properties).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      entry[1] !== null && typeof entry[1] === "object" && !Array.isArray(entry[1]),
  );
  return Object.fromEntries(entries);
}

function sampleEnumValue(schema: Record<string, unknown>): unknown {
  const values = schema["enum"];
  return Array.isArray(values) && values.length > 0 ? values[0] : undefined;
}

function sampleObjectValue(schema: Record<string, unknown>): Record<string, unknown> | undefined {
  const properties = objectProperties(schema);
  const required = Array.isArray(schema["required"])
    ? schema["required"].filter((value): value is string => typeof value === "string")
    : [];
  if (required.length === 0) {
    return undefined;
  }

  const result: Record<string, unknown> = {};
  for (const property of required) {
    const sample = sampleValueForProperty(property, properties[property]);
    if (sample === undefined) {
      return undefined;
    }
    result[property] = sample;
  }
  return result;
}

function sampleValueForProperty(
  propertyName: string,
  schema: Record<string, unknown> | undefined,
): unknown {
  if (!schema) {
    return undefined;
  }

  if ("default" in schema) {
    return schema["default"];
  }

  const enumValue = sampleEnumValue(schema);
  if (enumValue !== undefined) {
    return enumValue;
  }

  switch (propertyName) {
    case "url":
      return "https://example.com";
    case "selector":
      return "#submit";
    case "source_selector":
      return "#source";
    case "target_selector":
      return "#target";
    case "text":
      return "hello";
    case "expression":
      return "document.title";
    case "path":
    case "file_path":
      return "/tmp/report.pdf";
    case "device_id":
      return "default";
    case "query":
      return "console.error";
    case "enable_high_accuracy":
    case "clear":
      return true;
    case "width":
      return 1280;
    case "height":
      return 720;
    case "duration_ms":
      return 5000;
    case "quality":
      return 0.9;
    case "count":
      return 1;
    case "position":
      return { x: 100, y: 120 };
    case "viewport":
      return { width: 1280, height: 720 };
    default:
      break;
  }

  const type = schema["type"];
  if (type === "string") {
    return "example";
  }
  if (type === "boolean") {
    return true;
  }
  if (type === "integer") {
    return typeof schema["minimum"] === "number" ? Math.max(1, schema["minimum"]) : 1;
  }
  if (type === "number") {
    return typeof schema["minimum"] === "number" ? Math.max(1, schema["minimum"]) : 1;
  }
  if (type === "array") {
    const items = schema["items"];
    if (items !== null && typeof items === "object" && !Array.isArray(items)) {
      const item = sampleValueForProperty(propertyName, items as Record<string, unknown>);
      return item === undefined ? undefined : [item];
    }
    return [];
  }
  if (type === "object") {
    return sampleObjectValue(schema);
  }

  return undefined;
}

function buildFallbackPromptExample(tool: DedicatedCapabilityTool): string | undefined {
  const properties = objectProperties(tool.action.inputSchema);
  const required = Array.isArray(tool.action.inputSchema["required"])
    ? tool.action.inputSchema["required"].filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const exampleArgs: Record<string, unknown> = {};

  for (const property of required) {
    const value = sampleValueForProperty(property, properties[property]);
    if (value === undefined) {
      return undefined;
    }
    exampleArgs[property] = value;
  }

  if (tool.toolId !== "tool.location.get") {
    exampleArgs["node_id"] = "node_456";
  }
  if (tool.supportsDispatchTimeout) {
    exampleArgs["timeout_ms"] = 30000;
  }

  return JSON.stringify(exampleArgs);
}

function buildPromptExamples(tool: DedicatedCapabilityTool): readonly string[] | undefined {
  const explicit = DEDICATED_ROUTED_TOOL_EXAMPLES_BY_ID.get(tool.toolId);
  if (explicit) {
    return explicit;
  }

  const fallback = buildFallbackPromptExample(tool);
  return fallback ? [fallback] : undefined;
}

function buildToolDescriptor(tool: DedicatedCapabilityTool): ToolDescriptor {
  const promptExamples = buildPromptExamples(tool);
  return {
    id: tool.toolId,
    description: tool.action.description,
    effect: "state_changing",
    keywords: buildKeywords(tool),
    promptGuidance: DEDICATED_ROUTED_TOOL_PROMPT_GUIDANCE,
    ...(promptExamples ? { promptExamples } : {}),
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
          toolId: toolIdForCapabilityDescriptor(entry.descriptor.id),
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
