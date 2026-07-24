import type { ToolEffect } from "@tyrum/runtime-policy";
import { canonicalizeToolMatchTarget } from "../policy/match-target.js";
import type { HarnessToolCall, MappedHarnessTool } from "./types.js";
import { pathEscapesWorkspace } from "./workspace-confinement.js";

/**
 * One row of a backend's tool mapping table.
 *
 * A backend declares how each of its native tools projects onto Tyrum's tool
 * taxonomy. The table is data, not policy: it says *what* a call is, never
 * whether it is allowed. Capability posture stays in policy configuration.
 */
export interface HarnessToolMapEntry {
  /** Tyrum tool id the policy engine evaluates against. */
  readonly toolId: string;
  readonly effect: ToolEffect;
  /**
   * Rewrites harness-native argument names into the shape
   * `canonicalizeToolMatchTarget` expects (e.g. `file_path` -> `path`).
   */
  readonly toPolicyArgs: (input: Readonly<Record<string, unknown>>) => Record<string, unknown>;
  /** Extracts the egress URL for tools that reach the network. */
  readonly urlOf?: (input: Readonly<Record<string, unknown>>) => string | undefined;
  /**
   * Harness-native argument that addresses the filesystem, when the tool has
   * one. Declaring it is what lets the ask channel apply the same workspace
   * confinement `ToolExecutor.assertSandboxed` applies natively — the policy
   * match target cannot, because it collapses an escaping path to nothing.
   */
  readonly pathArg?: string;
}

export type HarnessToolMap = Readonly<Record<string, HarnessToolMapEntry>>;

const MCP_TOOL_PREFIX = "mcp__";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Converts an MCP tool name (`mcp__<server>__<tool>`) into Tyrum's dotted MCP
 * tool id (`mcp.<server>.<tool>`), which the policy match-target canonicalizer
 * already understands.
 */
function mcpToolIdFor(toolName: string): string | undefined {
  if (!toolName.startsWith(MCP_TOOL_PREFIX)) return undefined;
  const segments = toolName.slice(MCP_TOOL_PREFIX.length).split("__").filter(Boolean);
  if (segments.length === 0) return undefined;
  return `mcp.${segments.join(".")}`;
}

/**
 * Resolves a harness tool call onto Tyrum's taxonomy.
 *
 * Fails closed by design: a tool with no table entry is reported as
 * `state_changing` and unmapped, so the policy engine's implicit decision sends
 * it to the ask channel rather than silently allowing it.
 */
export function mapHarnessToolCall(input: {
  call: HarnessToolCall;
  toolMap: HarnessToolMap;
  workspaceRoot?: string;
  currentAgentKey?: string;
}): MappedHarnessTool {
  const entry = input.toolMap[input.call.toolName];
  const mcpToolId = entry ? undefined : mcpToolIdFor(input.call.toolName);
  const toolId = entry?.toolId ?? mcpToolId ?? input.call.toolName;
  const policyArgs = entry ? entry.toPolicyArgs(input.call.input) : { ...input.call.input };
  const pathArgument = entry?.pathArg ? asString(input.call.input[entry.pathArg]) : undefined;

  return {
    toolId,
    matchTarget: canonicalizeToolMatchTarget(
      toolId,
      policyArgs,
      input.workspaceRoot,
      input.currentAgentKey,
    ),
    // Unmapped tools — including every MCP tool, whose semantics Tyrum cannot
    // know statically — are treated as state-changing so they require approval.
    effect: entry?.effect ?? "state_changing",
    url: entry?.urlOf?.(input.call.input),
    mapped: entry !== undefined,
    pathArgument,
    escapesWorkspace:
      pathArgument !== undefined &&
      pathEscapesWorkspace({ path: pathArgument, workspaceRoot: input.workspaceRoot }),
  };
}

/** Shared helpers for backend tool tables. */
export const harnessArg = {
  /** `{ file_path }` -> `{ path }` for Tyrum's read/write/edit match targets. */
  path(field: string) {
    return (input: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
      path: asString(input[field]) ?? "",
    });
  },
  passthrough(...fields: readonly string[]) {
    return (input: Readonly<Record<string, unknown>>): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const field of fields) {
        out[field] = input[field];
      }
      return out;
    };
  },
  urlFrom(field: string) {
    return (input: Readonly<Record<string, unknown>>): string | undefined => asString(input[field]);
  },
} as const;
