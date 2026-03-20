import {
  DesktopActArgs,
  DesktopKeyboardArgs,
  DesktopMouseArgs,
  DesktopQueryArgs,
  DesktopScreenshotArgs,
  DesktopSnapshotArgs,
  DesktopWaitForArgs,
  RoutedToolTargeting,
} from "@tyrum/contracts";
import { z } from "zod";

type DedicatedDesktopToolEffect = "read_only" | "state_changing";

type DesktopToolSchema = z.ZodObject<Record<string, z.ZodTypeAny>>;

export type DedicatedDesktopToolDefinition = {
  toolId: string;
  capabilityId: string;
  actionName: string;
  description: string;
  effect: DedicatedDesktopToolEffect;
  keywords: readonly string[];
  promptExamples: readonly string[];
  inputParser: DesktopToolSchema;
};

const ROUTING_FIELDS = {
  node_id: RoutedToolTargeting.shape.node_id,
  timeout_ms: RoutedToolTargeting.shape.timeout_ms,
} as const;

const COMMON_PROMPT_GUIDANCE = [
  "Use node_id when you need to target a specific desktop node.",
  "Omit node_id only when the current lane has one attached eligible node or exactly one eligible node exists. Otherwise use tool.node.list first.",
] as const;

function withRoutingFields(schema: DesktopToolSchema): DesktopToolSchema {
  return schema.omit({ op: true }).extend(ROUTING_FIELDS).strict();
}

function jsonSchemaOf(schema: unknown): Record<string, unknown> {
  const candidate = schema as {
    toJSONSchema?: (opts?: { io?: "input" | "output" }) => unknown;
  };
  const json = candidate.toJSONSchema?.({ io: "input" });
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { type: "object", additionalProperties: false };
  }
  return json as Record<string, unknown>;
}

export const DEDICATED_DESKTOP_TOOL_PROMPT_GUIDANCE = COMMON_PROMPT_GUIDANCE;

export const DEDICATED_DESKTOP_TOOL_DEFINITIONS = [
  {
    toolId: "tool.desktop.screenshot",
    capabilityId: "tyrum.desktop.screenshot",
    actionName: "screenshot",
    description: "Capture a desktop screenshot.",
    effect: "read_only",
    keywords: ["desktop", "screen", "screenshot", "capture", "image"],
    promptExamples: ['{"display":"all","node_id":"node_123"}'],
    inputParser: withRoutingFields(DesktopScreenshotArgs),
  },
  {
    toolId: "tool.desktop.snapshot",
    capabilityId: "tyrum.desktop.snapshot",
    actionName: "snapshot",
    description: "Collect a desktop accessibility snapshot.",
    effect: "read_only",
    keywords: ["desktop", "snapshot", "accessibility", "tree", "ui"],
    promptExamples: ['{"include_tree":false}'],
    inputParser: withRoutingFields(DesktopSnapshotArgs),
  },
  {
    toolId: "tool.desktop.query",
    capabilityId: "tyrum.desktop.query",
    actionName: "query",
    description: "Query desktop UI elements.",
    effect: "read_only",
    keywords: ["desktop", "query", "ui", "find", "selector"],
    promptExamples: ['{"selector":{"kind":"a11y","role":"button","name":"Save"}}'],
    inputParser: withRoutingFields(DesktopQueryArgs),
  },
  {
    toolId: "tool.desktop.act",
    capabilityId: "tyrum.desktop.act",
    actionName: "act",
    description: "Perform a desktop UI action.",
    effect: "state_changing",
    keywords: ["desktop", "click", "focus", "ui", "act"],
    promptExamples: [
      '{"target":{"kind":"a11y","role":"button","name":"Save"},"action":{"kind":"click"}}',
    ],
    inputParser: withRoutingFields(DesktopActArgs),
  },
  {
    toolId: "tool.desktop.mouse",
    capabilityId: "tyrum.desktop.mouse",
    actionName: "mouse",
    description: "Perform a low-level desktop mouse action.",
    effect: "state_changing",
    keywords: ["desktop", "mouse", "click", "move", "drag"],
    promptExamples: ['{"action":"click","x":120,"y":240}'],
    inputParser: withRoutingFields(DesktopMouseArgs),
  },
  {
    toolId: "tool.desktop.keyboard",
    capabilityId: "tyrum.desktop.keyboard",
    actionName: "keyboard",
    description: "Perform a low-level desktop keyboard action.",
    effect: "state_changing",
    keywords: ["desktop", "keyboard", "type", "press", "key"],
    promptExamples: ['{"action":"type","text":"hello"}'],
    inputParser: withRoutingFields(DesktopKeyboardArgs),
  },
  {
    toolId: "tool.desktop.wait-for",
    capabilityId: "tyrum.desktop.wait-for",
    actionName: "wait_for",
    description: "Wait for a desktop UI condition.",
    effect: "read_only",
    keywords: ["desktop", "wait", "selector", "visible", "exists"],
    promptExamples: [
      '{"selector":{"kind":"ocr","text":"Done"},"state":"visible","timeout_ms":30000}',
    ],
    inputParser: withRoutingFields(DesktopWaitForArgs),
  },
] as const satisfies readonly DedicatedDesktopToolDefinition[];

const DEDICATED_DESKTOP_TOOL_DEFINITION_MAP = new Map<string, DedicatedDesktopToolDefinition>(
  DEDICATED_DESKTOP_TOOL_DEFINITIONS.map((definition) => [definition.toolId, definition] as const),
);

export function getDedicatedDesktopToolDefinition(
  toolId: string,
): DedicatedDesktopToolDefinition | undefined {
  return DEDICATED_DESKTOP_TOOL_DEFINITION_MAP.get(toolId);
}

export function buildDedicatedDesktopToolInputSchema(
  definition: DedicatedDesktopToolDefinition,
): Record<string, unknown> {
  return jsonSchemaOf(definition.inputParser);
}
