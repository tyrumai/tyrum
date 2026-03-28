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
type DedicatedDesktopDispatchTimeoutArg = "timeout_ms" | "dispatch_timeout_ms";

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
  dispatchTimeoutArg: DedicatedDesktopDispatchTimeoutArg;
};

const ROUTING_FIELDS = {
  node_id: RoutedToolTargeting.shape.node_id,
  timeout_ms: RoutedToolTargeting.shape.timeout_ms,
} as const;

const WAIT_FOR_ROUTING_FIELDS = {
  node_id: RoutedToolTargeting.shape.node_id,
  dispatch_timeout_ms: RoutedToolTargeting.shape.timeout_ms,
} as const;

const COMMON_PROMPT_GUIDANCE = [
  "Use node_id when you need to target a specific desktop node.",
  "Omit node_id only when the current conversation has one attached eligible node or exactly one eligible node exists. Otherwise use tool.node.list first.",
  "Use dispatch_timeout_ms when a desktop tool also has its own timeout_ms input, such as tool.desktop.wait-for.",
] as const;

function withRoutingFields(
  schema: DesktopToolSchema,
  dispatchTimeoutArg: DedicatedDesktopDispatchTimeoutArg = "timeout_ms",
): DesktopToolSchema {
  return schema
    .omit({ op: true })
    .extend(dispatchTimeoutArg === "dispatch_timeout_ms" ? WAIT_FOR_ROUTING_FIELDS : ROUTING_FIELDS)
    .strict();
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
    dispatchTimeoutArg: "timeout_ms",
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
    dispatchTimeoutArg: "timeout_ms",
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
    dispatchTimeoutArg: "timeout_ms",
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
    dispatchTimeoutArg: "timeout_ms",
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
    dispatchTimeoutArg: "timeout_ms",
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
    dispatchTimeoutArg: "timeout_ms",
  },
  {
    toolId: "tool.desktop.wait-for",
    capabilityId: "tyrum.desktop.wait-for",
    actionName: "wait_for",
    description: "Wait for a desktop UI condition.",
    effect: "read_only",
    keywords: ["desktop", "wait", "selector", "visible", "exists"],
    promptExamples: [
      '{"selector":{"kind":"ocr","text":"Done"},"state":"visible","timeout_ms":30000,"dispatch_timeout_ms":45000}',
    ],
    inputParser: withRoutingFields(DesktopWaitForArgs, "dispatch_timeout_ms"),
    dispatchTimeoutArg: "dispatch_timeout_ms",
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
