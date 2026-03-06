import type { WsEventEnvelope } from "@tyrum/schemas";
import { UuidSchema } from "@tyrum/schemas";
import type { ApprovalDal, ApprovalRow } from "./dal.js";
import type { PolicyOverrideDal, PolicyOverrideRow } from "../policy/override-dal.js";
import { isSafeSuggestedOverridePattern } from "../policy/override-guardrails.js";
import type { WsEventDal } from "../ws-event/dal.js";
import { toApprovalContract } from "./to-contract.js";
import {
  APPROVAL_POLICY_OVERRIDE_WS_AUDIENCE,
  APPROVAL_WS_AUDIENCE,
  type WsBroadcastAudience,
} from "../../ws/audience.js";
import {
  ensureApprovalResolvedEvent,
  ensurePolicyOverrideCreatedEvent,
} from "../../ws/stable-events.js";

type NormalizedSelectedOverride = {
  tool_id: string;
  pattern: string;
  workspace_id?: string;
};

type ApprovalResolveErrorCode = "invalid_request" | "not_found" | "unsupported";

export interface ResolveApprovalDeps {
  approvalDal: Pick<ApprovalDal, "resolveWithEngineAction"> & Partial<Pick<ApprovalDal, "getById">>;
  policyOverrideDal?: Pick<PolicyOverrideDal, "create">;
  wsEventDal?: WsEventDal;
  emitEvent?: (input: {
    tenantId: string;
    event: WsEventEnvelope;
    audience?: WsBroadcastAudience;
  }) => void;
}

export interface ResolveApprovalInput {
  tenantId: string;
  approvalId: string;
  decision: "approved" | "denied";
  reason?: string;
  mode?: "once" | "always";
  overrides?: Array<{ tool_id?: unknown; pattern?: unknown; workspace_id?: unknown }>;
  resolvedBy?: unknown;
}

export type ResolveApprovalResult =
  | {
      ok: true;
      approval: ApprovalRow;
      createdOverrides?: PolicyOverrideRow[];
      transitioned: boolean;
    }
  | {
      ok: false;
      code: ApprovalResolveErrorCode;
      message: string;
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractSuggestedOverrides(
  approvalContext: unknown,
): Array<{ tool_id: string; pattern: string; workspace_id?: string }> {
  if (!isObject(approvalContext)) return [];
  const policy = approvalContext["policy"];
  if (!isObject(policy)) return [];
  const suggested = policy["suggested_overrides"];
  if (!Array.isArray(suggested)) return [];

  const overrides: Array<{ tool_id: string; pattern: string; workspace_id?: string }> = [];
  for (const entry of suggested) {
    if (!isObject(entry)) continue;
    const toolId = entry["tool_id"];
    const pattern = entry["pattern"];
    const workspaceId = entry["workspace_id"];
    if (typeof toolId === "string" && typeof pattern === "string") {
      overrides.push({
        tool_id: toolId,
        pattern,
        workspace_id: typeof workspaceId === "string" ? workspaceId : undefined,
      });
    }
  }
  return overrides;
}

function extractPolicySnapshotId(approvalContext: unknown): string | undefined {
  if (!isObject(approvalContext)) return undefined;
  const policy = approvalContext["policy"];
  if (!isObject(policy)) return undefined;
  const value = policy["policy_snapshot_id"];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeSelectedOverrides(
  overrides: ResolveApprovalInput["overrides"],
): NormalizedSelectedOverride[] {
  if (!Array.isArray(overrides)) return [];

  const normalized: NormalizedSelectedOverride[] = [];
  for (const entry of overrides) {
    const toolId = typeof entry?.tool_id === "string" ? entry.tool_id.trim() : "";
    const pattern = typeof entry?.pattern === "string" ? entry.pattern.trim() : "";
    const workspaceId =
      typeof entry?.workspace_id === "string" ? entry.workspace_id.trim() : undefined;
    if (!toolId || !pattern) continue;
    normalized.push(
      workspaceId
        ? { tool_id: toolId, pattern, workspace_id: workspaceId }
        : { tool_id: toolId, pattern },
    );
  }

  return normalized;
}

function invalidRequest(message: string): ResolveApprovalResult {
  return { ok: false, code: "invalid_request", message };
}

function notFound(approvalId: string): ResolveApprovalResult {
  return {
    ok: false,
    code: "not_found",
    message: `approval ${String(approvalId)} not found`,
  };
}

export async function resolveApproval(
  deps: ResolveApprovalDeps,
  input: ResolveApprovalInput,
): Promise<ResolveApprovalResult> {
  const overrideDal = deps.policyOverrideDal;
  let selectedOverrides: NormalizedSelectedOverride[] | undefined;
  let policySnapshotId: string | undefined;

  if (input.decision === "approved" && input.mode === "always") {
    if (!deps.approvalDal.getById) {
      return {
        ok: false,
        code: "unsupported",
        message: "approval lookup not configured",
      };
    }

    const existing = await deps.approvalDal.getById({
      tenantId: input.tenantId,
      approvalId: input.approvalId,
    });
    if (!existing) {
      return notFound(input.approvalId);
    }

    if (existing.status !== "pending") {
      return { ok: true, approval: existing, transitioned: false };
    }

    if (!overrideDal) {
      return {
        ok: false,
        code: "unsupported",
        message: "policy overrides not configured",
      };
    }

    selectedOverrides = normalizeSelectedOverrides(input.overrides);
    if (selectedOverrides.length === 0) {
      return invalidRequest("mode=always requires selecting one or more overrides");
    }

    const suggestedOverrides = extractSuggestedOverrides(existing.context);
    const allowed = new Set(
      suggestedOverrides.map((override) => {
        return `${override.tool_id}::${override.pattern}::${override.workspace_id ?? ""}`;
      }),
    );

    for (const selectedOverride of selectedOverrides) {
      const key = `${selectedOverride.tool_id}::${selectedOverride.pattern}::${selectedOverride.workspace_id ?? ""}`;
      if (!allowed.has(key)) {
        return invalidRequest("requested overrides must be selected from suggested_overrides");
      }
      if (!isSafeSuggestedOverridePattern(selectedOverride.pattern)) {
        return invalidRequest("requested overrides violate deny guardrails");
      }
      if (selectedOverride.workspace_id) {
        const parsedWorkspaceId = UuidSchema.safeParse(selectedOverride.workspace_id);
        if (!parsedWorkspaceId.success) {
          return invalidRequest("workspace_id must be a UUID");
        }
      }
    }

    policySnapshotId = extractPolicySnapshotId(existing.context);
  }

  const resolved = await deps.approvalDal.resolveWithEngineAction({
    tenantId: input.tenantId,
    approvalId: input.approvalId,
    decision: input.decision,
    reason: input.reason,
    resolvedBy: input.resolvedBy,
  });
  if (!resolved) {
    return notFound(input.approvalId);
  }

  let createdOverrides: PolicyOverrideRow[] | undefined;
  if (
    resolved.transitioned &&
    resolved.approval.status === "approved" &&
    selectedOverrides &&
    selectedOverrides.length > 0 &&
    overrideDal
  ) {
    createdOverrides = [];
    for (const selectedOverride of selectedOverrides) {
      const row = await overrideDal.create({
        tenantId: input.tenantId,
        agentId: resolved.approval.agent_id,
        workspaceId: selectedOverride.workspace_id,
        toolId: selectedOverride.tool_id,
        pattern: selectedOverride.pattern,
        createdBy: input.resolvedBy,
        createdFromApprovalId: resolved.approval.approval_id,
        createdFromPolicySnapshotId: policySnapshotId,
      });
      createdOverrides.push(row);

      if (deps.emitEvent) {
        const persistedEvent = await ensurePolicyOverrideCreatedEvent({
          tenantId: input.tenantId,
          override: row,
          audience: APPROVAL_POLICY_OVERRIDE_WS_AUDIENCE,
          wsEventDal: deps.wsEventDal,
        });
        deps.emitEvent({
          tenantId: input.tenantId,
          event: persistedEvent.event,
          audience: APPROVAL_POLICY_OVERRIDE_WS_AUDIENCE,
        });
      }
    }
  }

  if (resolved.transitioned && deps.emitEvent) {
    const approval = toApprovalContract(resolved.approval);
    if (approval) {
      const persistedEvent = await ensureApprovalResolvedEvent({
        tenantId: input.tenantId,
        approval,
        wsEventDal: deps.wsEventDal,
      });
      deps.emitEvent({
        tenantId: input.tenantId,
        event: persistedEvent.event,
        audience: APPROVAL_WS_AUDIENCE,
      });
    }
  }

  return {
    ok: true,
    approval: resolved.approval,
    createdOverrides:
      createdOverrides && createdOverrides.length > 0 ? createdOverrides : undefined,
    transitioned: resolved.transitioned,
  };
}
