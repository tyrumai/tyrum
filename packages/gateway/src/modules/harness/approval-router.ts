import { createHash } from "node:crypto";
import { suggestedOverridesForToolCall, type PolicyService } from "@tyrum/runtime-policy";
import type { ApprovalDal, ApprovalStatus } from "../approval/dal.js";
import { coerceRecord } from "../util/coerce.js";
import { broadcastApprovalUpdated } from "../approval/update-broadcast.js";
import { createReviewedApproval } from "../review/review-init.js";
import type { ProtocolDeps } from "../../ws/protocol.js";
import { isHarnessToolRoleAllowed } from "./role-ceiling.js";
import { mapHarnessToolCall, type HarnessToolMap } from "./tool-mapping.js";
import type { HarnessApprovalDecision, HarnessToolCall, HarnessTurnContext } from "./types.js";

export interface HarnessApprovalRouterLogger {
  info: (message: string, fields?: Record<string, unknown>) => void;
  warn: (message: string, fields?: Record<string, unknown>) => void;
}

export interface HarnessApprovalRouterDeps {
  readonly policyService: PolicyService;
  readonly approvalDal: ApprovalDal;
  readonly protocolDeps?: ProtocolDeps;
  readonly toolMap: HarnessToolMap;
  readonly approvalWaitMs: number;
  readonly approvalPollMs: number;
  readonly logger: HarnessApprovalRouterLogger;
  /** Injected for tests; defaults to wall clock. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface HarnessApprovalRouter {
  /** Resolves a harness tool call to allow/deny, blocking on approval if gated. */
  evaluate(input: {
    call: HarnessToolCall;
    context: HarnessTurnContext;
    sessionRef?: string;
    /**
     * Invoked once a durable approval exists and the call is parked awaiting a
     * human, so operator surfaces can show the pending state while we block.
     */
    onApprovalPending?: (input: { callId: string; approvalId: string }) => Promise<void> | void;
  }): Promise<HarnessApprovalDecision>;
}

const TERMINAL_DENY_STATUSES: ReadonlySet<ApprovalStatus> = new Set([
  "denied",
  "expired",
  "cancelled",
]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Distinguishes this exact request from any other that could share a call id.
 *
 * `HarnessToolCall.callId` only promises to correlate the ask and observation
 * taps within one turn; harnesses may restart their counters on a fresh
 * session. Approval keys are unique per tenant and `ApprovalDal.create` does
 * nothing on conflict, so a colliding key would silently hand back an older
 * row — potentially an already-approved one for a different call.
 */
function requestFingerprint(input: {
  toolId: string;
  matchTarget: string;
  toolInput: Readonly<Record<string, unknown>>;
}): string {
  const canonical = JSON.stringify([
    input.toolId,
    input.matchTarget,
    // Key order is stable for a given harness payload; this is a collision
    // guard, not a security boundary (the identity check below is).
    input.toolInput,
  ]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * Fail-closed check that a resolved approval belongs to the call in hand.
 *
 * Defence in depth behind the fingerprinted key: even if a key ever collided,
 * an approval whose recorded tool identity differs must never authorize this
 * call.
 */
function approvalMatchesRequest(input: {
  context: unknown;
  callId: string;
  toolId: string;
  matchTarget: string;
}): boolean {
  const context = coerceRecord(input.context);
  if (!context || context["source"] !== "harness-tool-execution") return false;
  return (
    context["tool_call_id"] === input.callId &&
    context["tool_id"] === input.toolId &&
    context["tool_match_target"] === input.matchTarget
  );
}

/**
 * True for a match target that carries no target, only its operation prefix
 * (`read:`, `write:`, `glob:`) or nothing at all. Such a target identifies a
 * whole class of calls rather than the one an operator is looking at.
 */
function isDegenerateMatchTarget(matchTarget: string): boolean {
  const trimmed = matchTarget.trim();
  return trimmed.length === 0 || trimmed.endsWith(":");
}

function denyReasonFor(status: ApprovalStatus, reason?: string): string {
  if (reason && reason.trim().length > 0) return reason;
  if (status === "expired") return "approval expired before it was resolved";
  if (status === "cancelled") return "approval was cancelled";
  return "operator denied this tool call";
}

/**
 * The shared ask channel for every harness backend.
 *
 * Each adapter routes its permission callback here; the router evaluates Tyrum
 * policy, and on `require_approval` creates a durable approval through the
 * existing approval engine and blocks until a human resolves it. There is no
 * parallel approval mechanism (ARCH-22).
 */
export function createHarnessApprovalRouter(
  deps: HarnessApprovalRouterDeps,
): HarnessApprovalRouter {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? defaultSleep;

  return {
    evaluate: async ({ call, context, sessionRef, onApprovalPending }) => {
      const mapped = mapHarnessToolCall({
        call,
        toolMap: deps.toolMap,
        workspaceRoot: context.workspaceRoot,
      });

      // Workspace confinement is an executor invariant, not a policy posture:
      // the native path throws in `assertSandboxed` before any tool runs, and
      // it does so whether or not policy is in observe-only mode. The harness
      // runs its own tools, so this callback is the last place the raw path is
      // visible.
      if (mapped.escapesWorkspace) {
        deps.logger.warn("harness.tool.path_escapes_workspace", {
          backend_id: context.backendId,
          tool_id: mapped.toolId,
          tool_name: call.toolName,
          conversation_id: context.conversationId,
        });
        return {
          kind: "deny",
          reason: `path escapes workspace: ${mapped.pathArgument ?? ""}`,
        };
      }

      // The execution-profile and state-mode ceiling the native tool set
      // builder resolves. `false` is the engine's only unconditional deny.
      const roleAllowed = isHarnessToolRoleAllowed({
        ceiling: context.roleCeiling,
        mapped,
      });

      const evaluation = await deps.policyService.evaluateToolCall({
        tenantId: context.tenantId,
        agentId: context.agentId,
        workspaceId: context.workspaceId,
        toolId: mapped.toolId,
        toolMatchTarget: mapped.matchTarget,
        url: mapped.url,
        toolEffect: mapped.effect,
        roleAllowed,
        // Harness output is model-authored and therefore never trusted input.
        inputProvenance: { source: `harness:${context.backendId}`, trusted: false },
      });

      // A role-ceiling refusal is not an enforcement posture either. Natively
      // the tool is absent from the turn's tool surface altogether, and
      // observe-only mode does not put it back, so it is settled before the
      // observe-only branch below.
      if (!roleAllowed) {
        deps.logger.info("harness.tool.denied_by_role_ceiling", {
          backend_id: context.backendId,
          tool_id: mapped.toolId,
          tool_name: call.toolName,
          state_mode: context.roleCeiling?.stateMode,
          conversation_id: context.conversationId,
        });
        return {
          kind: "deny",
          reason: `tool '${mapped.toolId}' is not available to this conversation`,
        };
      }

      // Observe-only is an observation posture, not an enforcement one. The
      // native tool path gates deny and require_approval alike on
      // `!isObserveOnly()`; a conversation switched to a harness backend must
      // not start enforcing decisions the native path would only have recorded.
      if (deps.policyService.isObserveOnly()) {
        deps.logger.info("harness.tool.observed_only", {
          backend_id: context.backendId,
          tool_id: mapped.toolId,
          tool_name: call.toolName,
          decision: evaluation.decision,
          conversation_id: context.conversationId,
        });
        return { kind: "allow" };
      }

      if (evaluation.decision === "deny") {
        deps.logger.info("harness.tool.denied_by_policy", {
          backend_id: context.backendId,
          tool_id: mapped.toolId,
          tool_name: call.toolName,
          conversation_id: context.conversationId,
        });
        return { kind: "deny", reason: `policy denies '${mapped.toolId}'` };
      }

      if (evaluation.decision === "allow") {
        return { kind: "allow" };
      }

      return await awaitHarnessApproval({
        deps,
        call,
        context,
        sessionRef,
        onApprovalPending,
        mapped,
        policySnapshotId: evaluation.policy_snapshot?.policy_snapshot_id,
        appliedOverrideIds: evaluation.applied_override_ids,
        now,
        sleep,
      });
    },
  };
}

async function awaitHarnessApproval(input: {
  deps: HarnessApprovalRouterDeps;
  call: HarnessToolCall;
  context: HarnessTurnContext;
  sessionRef?: string;
  onApprovalPending?: (input: { callId: string; approvalId: string }) => Promise<void> | void;
  mapped: ReturnType<typeof mapHarnessToolCall>;
  policySnapshotId?: string;
  appliedOverrideIds?: string[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}): Promise<HarnessApprovalDecision> {
  const { deps, call, context, mapped } = input;
  const deadline = input.now() + deps.approvalWaitMs;
  const fingerprint = requestFingerprint({
    toolId: mapped.toolId,
    matchTarget: mapped.matchTarget,
    toolInput: call.input,
  });
  const approvalKey = [
    "harness",
    context.backendId,
    context.conversationId,
    context.turnId ?? "no-turn",
    call.callId,
    fingerprint,
  ].join(":");
  // Drives the operator UI's "Always approve" action; `resolveApproval` rejects
  // `mode=always` unless the selected overrides came from this list.
  //
  // Withheld for a degenerate match target. `canonicalizeToolMatchTarget`
  // reduces a target it cannot express — an empty or unrepresentable path — to
  // the bare `write:` / `read:` prefix, and an override minted from that would
  // match every later call the canonicalizer collapsed the same way rather than
  // the one call the operator actually saw.
  const suggestedOverrides = isDegenerateMatchTarget(mapped.matchTarget)
    ? []
    : suggestedOverridesForToolCall({
        toolId: mapped.toolId,
        matchTarget: mapped.matchTarget,
        workspaceId: context.workspaceId,
      });

  const approval = await createReviewedApproval({
    approvalDal: deps.approvalDal,
    policyService: deps.policyService,
    emitUpdate: async (created) => {
      await broadcastApprovalUpdated({
        tenantId: context.tenantId,
        approval: created,
        protocolDeps: deps.protocolDeps,
      });
    },
    params: {
      tenantId: context.tenantId,
      kind: "workflow_step",
      agentId: context.agentId,
      workspaceId: context.workspaceId,
      approvalKey,
      prompt: `Approve execution of '${call.toolName}' (${mapped.toolId})`,
      motivation: `The ${context.backendId} harness requested permission to run '${call.toolName}' for this turn.`,
      context: {
        source: "harness-tool-execution",
        backend_id: context.backendId,
        harness_session_ref: input.sessionRef,
        harness_tool_name: call.toolName,
        tool_id: mapped.toolId,
        tool_call_id: call.callId,
        tool_match_target: mapped.matchTarget,
        tool_mapped: mapped.mapped,
        args: call.input,
        conversation_id: context.conversationId,
        channel: context.channel,
        thread_id: context.threadId,
        policy: {
          policy_snapshot_id: input.policySnapshotId,
          agent_id: context.agentId,
          workspace_id: context.workspaceId,
          applied_override_ids: input.appliedOverrideIds,
          suggested_overrides: suggestedOverrides,
        },
      },
      expiresAt: new Date(deadline).toISOString(),
      conversationId: context.conversationId,
      turnId: context.turnId,
    },
  });

  deps.logger.info("harness.approval.created", {
    approval_id: approval.approval_id,
    backend_id: context.backendId,
    tool_id: mapped.toolId,
    tool_name: call.toolName,
    tool_call_id: call.callId,
    expires_at: approval.expires_at,
  });

  await input.onApprovalPending?.({
    callId: call.callId,
    approvalId: approval.approval_id,
  });

  while (input.now() < deadline) {
    await deps.approvalDal.expireStale({ tenantId: context.tenantId });
    const current = await deps.approvalDal.getById({
      tenantId: context.tenantId,
      approvalId: approval.approval_id,
    });

    if (!current) {
      return {
        kind: "deny",
        reason: "approval record not found",
        approvalId: approval.approval_id,
      };
    }
    if (
      !approvalMatchesRequest({
        context: current.context,
        callId: call.callId,
        toolId: mapped.toolId,
        matchTarget: mapped.matchTarget,
      })
    ) {
      deps.logger.warn("harness.approval.identity_mismatch", {
        approval_id: current.approval_id,
        backend_id: context.backendId,
        tool_id: mapped.toolId,
        tool_call_id: call.callId,
      });
      return {
        kind: "deny",
        reason: "approval does not match this tool call",
        approvalId: current.approval_id,
      };
    }
    if (current.status === "approved") {
      return { kind: "allow", approvalId: current.approval_id };
    }
    if (TERMINAL_DENY_STATUSES.has(current.status)) {
      return {
        kind: "deny",
        reason: denyReasonFor(current.status, current.latest_review?.reason ?? undefined),
        approvalId: current.approval_id,
      };
    }

    await input.sleep(Math.min(deps.approvalPollMs, Math.max(1, deadline - input.now())));
  }

  const expired = await deps.approvalDal.expireById({
    tenantId: context.tenantId,
    approvalId: approval.approval_id,
  });
  return {
    kind: "deny",
    reason: denyReasonFor("expired", expired?.latest_review?.reason ?? undefined),
    approvalId: approval.approval_id,
  };
}
