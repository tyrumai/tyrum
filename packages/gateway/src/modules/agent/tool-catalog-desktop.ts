import type { ToolDescriptor } from "./tools.js";
import {
  buildDedicatedDesktopToolInputSchema,
  DEDICATED_DESKTOP_TOOL_DEFINITIONS,
  DEDICATED_DESKTOP_TOOL_PROMPT_GUIDANCE,
} from "./tool-desktop-definitions.js";

export const DESKTOP_TOOL_REGISTRY: readonly ToolDescriptor[] =
  DEDICATED_DESKTOP_TOOL_DEFINITIONS.map((definition) => ({
    id: definition.toolId,
    description: definition.description,
    effect: definition.effect,
    keywords: definition.keywords,
    promptGuidance: DEDICATED_DESKTOP_TOOL_PROMPT_GUIDANCE,
    promptExamples: definition.promptExamples,
    source: "builtin",
    family: "desktop",
    inputSchema: buildDedicatedDesktopToolInputSchema(definition),
  }));
