import type { ExecutionBackendId } from "@tyrum/contracts";
import type { ToolEffect } from "@tyrum/runtime-policy";
import type { GatewayStateMode } from "../runtime-state/mode.js";

/**
 * Vocabulary shared by every harness adapter. Adapters translate their native
 * event stream into these shapes; the translation and approval layers only ever
 * see this union, never a vendor SDK type.
 */

/** A tool call as the harness names it, before mapping onto Tyrum's taxonomy. */
export interface HarnessToolCall {
  /** Harness-assigned identifier, used to correlate the ask and observation taps. */
  readonly callId: string;
  /** Harness-native tool name, e.g. `Bash`, `Edit`, `mcp__github__get_issue`. */
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/** A harness tool call resolved onto Tyrum's tool taxonomy (ARCH-21). */
export interface MappedHarnessTool {
  /** Tyrum tool id the policy engine evaluates, e.g. `bash`, `read`. */
  readonly toolId: string;
  /** Canonical policy match target for this call's arguments. */
  readonly matchTarget: string;
  readonly effect: ToolEffect;
  /** Present only for tools that perform network egress, for egress policy. */
  readonly url?: string;
  /**
   * False when the harness tool has no entry in the mapping table. Such calls
   * are evaluated as `state_changing` so they fail closed onto the ask channel.
   */
  readonly mapped: boolean;
  /**
   * The raw filesystem argument this call addresses, when the mapping table
   * declares one. Kept unnormalized because the match target cannot express it:
   * a path outside the workspace canonicalizes to the empty string.
   */
  readonly pathArgument?: string;
  /**
   * True when `pathArgument` resolves outside the workspace root. The native
   * path refuses such a call in `ToolExecutor.assertSandboxed`; the ask channel
   * is the only place a harness call can be refused for the same reason.
   */
  readonly escapesWorkspace: boolean;
}

/**
 * The role ceiling the native path applies through `isRoleAllowedForTool`.
 *
 * Two gates the tool set builder resolves before policy is consulted: the
 * execution profile's tool allow/deny lists, and the gateway state mode, which
 * withdraws the filesystem and shell builtins outside `local`. Both produce an
 * unconditional `deny` in the policy engine (`roleAllowed === false`) rather
 * than an approvable prompt, so a harness turn must carry them too.
 */
export interface HarnessRoleCeiling {
  readonly stateMode: GatewayStateMode;
  /** Execution-profile allowlist; absent means no profile ceiling applies. */
  readonly toolAllowlist?: readonly string[];
  readonly toolDenylist?: readonly string[];
}

export type HarnessApprovalDecision =
  | { readonly kind: "allow"; readonly approvalId?: string }
  | { readonly kind: "deny"; readonly reason: string; readonly approvalId?: string };

/**
 * Normalized harness event stream. Adapters emit these; the translation layer
 * turns them into Tyrum transcript events and `chat.ui-message.stream` frames.
 */
export type HarnessEvent =
  | { readonly kind: "session_started"; readonly sessionRef: string; readonly resumed: boolean }
  | { readonly kind: "assistant_text"; readonly text: string }
  | { readonly kind: "tool_call"; readonly call: HarnessToolCall }
  | {
      readonly kind: "tool_result";
      readonly callId: string;
      readonly toolName: string;
      readonly ok: boolean;
      readonly content: string;
    }
  | {
      readonly kind: "approval_resolved";
      readonly callId: string;
      readonly toolName: string;
      readonly decision: HarnessApprovalDecision;
    }
  | {
      readonly kind: "turn_completed";
      readonly reply: string;
      readonly usedTools: readonly string[];
    }
  | { readonly kind: "error"; readonly message: string };

/** Identifies the conversation a harness session belongs to. */
export interface HarnessTurnContext {
  readonly backendId: ExecutionBackendId;
  readonly tenantId: string;
  readonly agentId: string;
  readonly workspaceId: string;
  readonly conversationId: string;
  readonly conversationKey: string;
  readonly channel: string;
  readonly threadId: string;
  readonly turnId?: string;
  /** Workspace-scoped directory the harness is confined to. */
  readonly workspaceRoot: string;
  /**
   * Execution-profile and state-mode ceiling for this turn. Absent means no
   * ceiling was resolved, which the router treats exactly as the native
   * `isRoleAllowedForTool` treats a missing allowlist.
   */
  readonly roleCeiling?: HarnessRoleCeiling;
}
