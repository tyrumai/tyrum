import { randomUUID } from "node:crypto";
import type { NodePairingRequest } from "@tyrum/contracts";
import type { GatewayContainer } from "../../container.js";
import { AgentRuntime } from "../agent/runtime.js";
import { resolveAgentHome } from "../agent/home.js";
import type { ApprovalRow } from "../approval/dal.js";
import { toApprovalContract } from "../approval/to-contract.js";
import type { Logger } from "../observability/logger.js";
import {
  DEFAULT_WORKSPACE_KEY,
  requirePrimaryAgentId,
  requirePrimaryAgentKey,
} from "../identity/scope.js";
import type { WorkboardDal } from "../workboard/dal.js";
import { SubagentService } from "../workboard/subagent-service.js";
import { APPROVAL_WS_AUDIENCE, PAIRING_WS_AUDIENCE } from "../../ws/audience.js";
import { broadcastWsEvent } from "../../ws/broadcast.js";
import type { PairingApprovedDeliveryDeps } from "../../ws/pairing-approved.js";
import { ensureApprovalUpdatedEvent, ensurePairingResolvedEvent } from "../../ws/stable-events.js";
import type { WsEventDal } from "../ws-event/dal.js";
import type { SecretProvider } from "../secret/provider.js";
import type { ApprovalGuardianDecision, PairingGuardianDecision } from "./guardian-review-mode.js";
import { DesktopEnvironmentDal } from "../desktop-environments/dal.js";
import {
  enrichApprovalWithManagedDesktop,
  enrichPairingWithManagedDesktop,
} from "../desktop-environments/managed-desktop-reference.js";

export type GuardianProcessorOptions = {
  container: GatewayContainer;
  secretProviderForTenant: (tenantId: string) => SecretProvider;
  owner: string;
  tenantId?: string;
  logger?: Logger;
  wsEventDal?: WsEventDal;
  tickMs?: number;
  staleReviewMs?: number;
  batchSize?: number;
  keepProcessAlive?: boolean;
  ws?: PairingApprovedDeliveryDeps;
};

export function truncateText(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}...`;
}

export function isoToMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function summarizeApproval(approval: ApprovalRow): unknown {
  return {
    approval_id: approval.approval_id,
    kind: approval.kind,
    status: approval.status,
    prompt: approval.prompt,
    motivation: approval.motivation,
    context: approval.context,
    created_at: approval.created_at,
    expires_at: approval.expires_at,
    conversation_id: approval.conversation_id,
    turn_id: approval.turn_id,
    latest_review: approval.latest_review,
  };
}

function summarizeTranscriptItem(item: Record<string, unknown>): unknown {
  const kind = item["kind"];
  if (kind === "text") {
    return {
      kind,
      role: item["role"],
      content: truncateText(String(item["content"] ?? ""), 600),
      created_at: item["created_at"],
    };
  }
  if (kind === "tool") {
    return {
      kind,
      tool_id: item["tool_id"],
      tool_call_id: item["tool_call_id"],
      status: item["status"],
      summary: truncateText(String(item["summary"] ?? ""), 400),
      error: item["error"],
      created_at: item["created_at"],
      updated_at: item["updated_at"],
    };
  }
  if (kind === "approval") {
    return {
      kind,
      approval_id: item["approval_id"],
      status: item["status"],
      title: item["title"],
      detail: truncateText(String(item["detail"] ?? ""), 400),
      created_at: item["created_at"],
      updated_at: item["updated_at"],
    };
  }
  return { kind: typeof kind === "string" ? kind : "unknown" };
}

export function buildApprovalReviewMessage(
  approval: ApprovalRow,
  conversation?: {
    conversation_id: string;
    summary: string;
    transcript: unknown[];
  },
): string {
  const evidence = {
    subject: summarizeApproval(approval),
    conversation: conversation
      ? {
          conversation_id: conversation.conversation_id,
          summary: truncateText(conversation.summary, 1_200),
          transcript: conversation.transcript
            .slice(-12)
            .map((item) => summarizeTranscriptItem(item as Record<string, unknown>)),
        }
      : undefined,
  };
  return [
    "Review this approval request.",
    "Treat missing or omitted fields as unknown, not safe.",
    "If the evidence is incomplete or ambiguous, route to requested_human.",
    "",
    JSON.stringify(evidence, null, 2),
  ].join("\n");
}

export function buildPairingReviewMessage(pairing: NodePairingRequest): string {
  return [
    "Review this pairing request.",
    "Treat missing or omitted fields as unknown, not safe.",
    "If the safe trust level or capability allowlist is unclear, route to requested_human.",
    "",
    JSON.stringify(pairing, null, 2),
  ].join("\n");
}

export function isValidGuardianPairingDecision(
  pairing: NodePairingRequest,
  trustLevel: PairingGuardianDecision["trust_level"],
  capabilityAllowlist: PairingGuardianDecision["capability_allowlist"],
): capabilityAllowlist is NonNullable<PairingGuardianDecision["capability_allowlist"]> {
  return Boolean(
    trustLevel &&
    Array.isArray(capabilityAllowlist) &&
    capabilityAllowlist.every((capability) =>
      pairing.node.capabilities.some((candidate) => candidate.id === capability.id),
    ),
  );
}

export function buildGuardianApproveDecisionPayload(
  decision: ApprovalGuardianDecision | PairingGuardianDecision,
  subagentId: string | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    decision: "approve",
    reason: decision.reason,
    risk_level: decision.risk_level,
    risk_score: decision.risk_score,
    evidence: decision.evidence ?? null,
    ...extra,
    actor: {
      kind: "guardian",
      reviewer_subagent_id: subagentId ?? null,
    },
  };
}

export function buildGuardianRequestedHumanPayload(
  decision: ApprovalGuardianDecision | PairingGuardianDecision,
  subagentId: string | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    decision: "requested_human",
    reason: decision.reason,
    risk_level: decision.risk_level,
    risk_score: decision.risk_score,
    evidence: decision.evidence ?? null,
    ...extra,
    actor: {
      kind: "guardian",
      reviewer_subagent_id: subagentId ?? null,
    },
  };
}

export function buildFailedDecisionPayload(
  message: string,
  subagentId: string | undefined,
): Record<string, unknown> {
  return {
    decision: "failed",
    error: truncateText(message, 1_000),
    actor: {
      kind: "system",
      reviewer_subagent_id: subagentId ?? null,
    },
  };
}

function buildReviewerConversationKey(agentKey: string, subagentId: string): string {
  return `agent:${agentKey}:subagent:${subagentId}`;
}

export function reviewerTurnMetadata(input: {
  agentKey: string;
  subagentId: string;
  subjectType: "approval" | "pairing";
  targetId: string;
}): Record<string, unknown> {
  return {
    tyrum_key: buildReviewerConversationKey(input.agentKey, input.subagentId),
    subagent_id: input.subagentId,
    guardian_review: {
      subject_type: input.subjectType,
      target_id: input.targetId,
    },
  };
}

export async function getOrCreateReviewerRuntime(input: {
  cache: Map<string, AgentRuntime>;
  container: GatewayContainer;
  tenantId: string;
  secretProviderForTenant: (tenantId: string) => SecretProvider;
}): Promise<AgentRuntime> {
  const cached = input.cache.get(input.tenantId);
  if (cached) return cached;
  const agentKey = await requirePrimaryAgentKey(input.container.identityScopeDal, input.tenantId);

  const runtime = new AgentRuntime({
    container: input.container,
    tenantId: input.tenantId,
    agentId: agentKey,
    home: resolveAgentHome(input.container.config.tyrumHome, agentKey),
    fetchImpl: fetch,
    secretProvider: input.secretProviderForTenant(input.tenantId),
    policyService: input.container.policyService,
  });
  input.cache.set(input.tenantId, runtime);
  return runtime;
}

async function resolveReviewerScope(container: GatewayContainer, tenantId: string) {
  const agentId = await requirePrimaryAgentId(container.identityScopeDal, tenantId);
  const workspaceId = await container.identityScopeDal.ensureWorkspaceId(
    tenantId,
    DEFAULT_WORKSPACE_KEY,
  );
  await container.identityScopeDal.ensureMembership(tenantId, agentId, workspaceId);
  return {
    tenant_id: tenantId,
    agent_id: agentId,
    workspace_id: workspaceId,
  };
}

export async function createReviewerSubagent(input: {
  container: GatewayContainer;
  workboard: WorkboardDal;
  tenantId: string;
}) {
  const scope = await resolveReviewerScope(input.container, input.tenantId);
  const agentKey = await requirePrimaryAgentKey(input.container.identityScopeDal, input.tenantId);
  const subagentId = randomUUID();
  return await new SubagentService({ db: input.container.db }).createSubagent({
    scope,
    subagentId,
    subagent: {
      execution_profile: "reviewer_ro",
      conversation_key: buildReviewerConversationKey(agentKey, subagentId),
      status: "running",
    },
  });
}

export async function markReviewerClosed(input: {
  container: GatewayContainer;
  workboard: WorkboardDal;
  tenantId: string;
  subagentId: string;
}) {
  const scope = await resolveReviewerScope(input.container, input.tenantId);
  await input.workboard.markSubagentClosed({ scope, subagent_id: input.subagentId });
}

export async function markReviewerFailed(input: {
  container: GatewayContainer;
  workboard: WorkboardDal;
  tenantId: string;
  subagentId: string;
  reason: string;
}) {
  const scope = await resolveReviewerScope(input.container, input.tenantId);
  await input.workboard.markSubagentFailed({
    scope,
    subagent_id: input.subagentId,
    reason: truncateText(input.reason, 800),
  });
}

type GuardianBroadcastDeps = {
  container: GatewayContainer;
  logger?: Logger;
  ws?: PairingApprovedDeliveryDeps;
  wsEventDal?: WsEventDal;
};

export async function emitApprovalUpdate(input: {
  approval: ApprovalRow;
  deps: GuardianBroadcastDeps;
}): Promise<void> {
  const contract = toApprovalContract(input.approval);
  if (!contract || !input.deps.ws) return;
  const enrichedApproval = await enrichApprovalWithManagedDesktop({
    environmentDal: new DesktopEnvironmentDal(input.deps.container.db),
    tenantId: input.approval.tenant_id,
    approval: contract,
  });
  const persisted = await ensureApprovalUpdatedEvent({
    tenantId: input.approval.tenant_id,
    approval: enrichedApproval,
    wsEventDal: input.deps.wsEventDal,
  });
  broadcastWsEvent(
    input.approval.tenant_id,
    persisted.event,
    {
      connectionManager: input.deps.ws.connectionManager,
      cluster: input.deps.ws.cluster,
      logger: input.deps.logger,
      maxBufferedBytes: input.deps.ws.maxBufferedBytes,
    },
    APPROVAL_WS_AUDIENCE,
  );
}

export async function emitPairingUpdate(input: {
  tenantId: string;
  pairing: NodePairingRequest;
  deps: GuardianBroadcastDeps;
  scopedToken?: string;
}): Promise<void> {
  if (!input.deps.ws) return;
  const pairingForEvent = input.pairing.node.managed_desktop
    ? input.pairing
    : await enrichPairingWithManagedDesktop({
        environmentDal: new DesktopEnvironmentDal(input.deps.container.db),
        tenantId: input.tenantId,
        pairing: input.pairing,
      });
  const persisted = await ensurePairingResolvedEvent({
    tenantId: input.tenantId,
    pairing: pairingForEvent,
    wsEventDal: input.deps.wsEventDal,
    scopedToken: input.scopedToken,
  });
  broadcastWsEvent(
    input.tenantId,
    persisted.event,
    {
      connectionManager: input.deps.ws.connectionManager,
      cluster: input.deps.ws.cluster,
      logger: input.deps.logger,
      maxBufferedBytes: input.deps.ws.maxBufferedBytes,
    },
    PAIRING_WS_AUDIENCE,
  );
}
