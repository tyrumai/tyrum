import {
  WorkItemLink,
  type DeploymentConfig as DeploymentConfigT,
  type WorkScope,
} from "@tyrum/contracts";
import {
  WorkboardService as RuntimeWorkboardService,
  type ManagedDesktopProvisioner,
  type WorkboardCrudRepository,
  type WorkboardRepository,
  type WorkboardConversationKeyBuilder,
  type WorkboardServiceEffects,
  type WorkboardTaskRow,
  type WorkboardSubagentRuntime,
} from "@tyrum/runtime-workboard";
import type { SqlDb } from "../../statestore/types.js";
import type { AgentRegistry } from "../agent/registry.js";
import { IdentityScopeDal } from "../identity/scope.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { ProtocolDeps } from "../../ws/protocol/types.js";
import type { PolicyService } from "@tyrum/runtime-policy";
import { tryAcquireConcurrencySlotTx } from "../execution/engine/concurrency-manager.js";
import { broadcastApprovalUpdated } from "../approval/update-broadcast.js";
import { createReviewedApproval } from "../review/review-init.js";
import { WorkboardDal } from "./dal.js";
import { provisionManagedDesktop } from "./orchestration-support.js";
import {
  clearSubagentSignals,
  completePendingInterventionApprovals,
  createCapturedWorkItem,
  emitDeleteEffects,
  emitItemEvent,
  interruptSubagents,
  loadDeleteEffects,
  loadTaskRows,
  maybeEnqueueStateChangeNotification,
} from "./service-support.js";
import { resolveAgentKeyById, runSubagentTurn } from "./subagent-runtime-support.js";
import {
  toGatewaySubagentCreateParams,
  toGatewaySubagentGetParams,
  toGatewaySubagentListParams,
} from "./runtime-workboard-subagent-params.js";

class GatewayWorkboardRepository implements WorkboardRepository, WorkboardCrudRepository {
  private readonly workboard: WorkboardDal;

  constructor(
    private readonly db: SqlDb,
    private readonly opts: {
      redactionEngine?: RedactionEngine;
      approvalDal?: ApprovalDal;
      policyService?: PolicyService;
      protocolDeps?: ProtocolDeps;
    } = {},
  ) {
    this.workboard = new WorkboardDal(db, opts.redactionEngine);
  }

  async listBacklogItems(limit: number) {
    return await this.db.all<{
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
      work_item_id: string;
    }>(
      `SELECT tenant_id, agent_id, workspace_id, work_item_id
       FROM work_items
       WHERE status = 'backlog'
       ORDER BY created_at ASC
       LIMIT ?`,
      [limit],
    );
  }

  async listReadyItems(limit: number) {
    return await this.db.all<{
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
      work_item_id: string;
    }>(
      `SELECT tenant_id, agent_id, workspace_id, work_item_id
       FROM work_items
       WHERE status = 'ready'
       ORDER BY priority DESC, created_at ASC
       LIMIT ?`,
      [limit],
    );
  }

  async listDoingItems(limit: number) {
    return await this.db.all<{
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
      work_item_id: string;
    }>(
      `SELECT tenant_id, agent_id, workspace_id, work_item_id
       FROM work_items
       WHERE status = 'doing'
       ORDER BY updated_at ASC
       LIMIT ?`,
      [limit],
    );
  }

  async listPlannerSubagentsOutsideBacklog(limit: number) {
    return await this.db.all<{
      tenant_id: string;
      agent_id: string;
      workspace_id: string;
      subagent_id: string;
      work_item_id: string;
    }>(
      `SELECT s.tenant_id, s.agent_id, s.workspace_id, s.subagent_id, s.work_item_id
       FROM subagents s
       JOIN work_items i ON i.tenant_id = s.tenant_id AND i.work_item_id = s.work_item_id
       WHERE s.execution_profile = 'planner'
         AND s.status IN ('running', 'paused')
         AND i.status <> 'backlog'
       LIMIT ?`,
      [limit],
    );
  }

  async getItem(params: Parameters<WorkboardDal["getItem"]>[0]) {
    return await this.workboard.getItem(params);
  }

  async createItem(params: Parameters<WorkboardCrudRepository["createItem"]>[0]) {
    return await createCapturedWorkItem({
      workboard: this.workboard,
      db: this.db,
      redactionEngine: this.opts.redactionEngine,
      protocolDeps: this.opts.protocolDeps,
      scope: params.scope,
      item: {
        ...params.item,
        budgets: params.item.budgets ?? undefined,
      },
      createdFromConversationKey: params.createdFromConversationKey,
      captureEvent: params.captureEvent,
    });
  }

  async listItems(params: Parameters<WorkboardDal["listItems"]>[0]) {
    return await this.workboard.listItems(params);
  }

  async updateItem(params: Parameters<WorkboardDal["updateItem"]>[0]) {
    return await this.workboard.updateItem(params);
  }

  async deleteItem(params: Parameters<WorkboardDal["deleteItem"]>[0]) {
    return await this.workboard.deleteItem(params);
  }

  async transitionItem(params: Parameters<WorkboardDal["transitionItem"]>[0]) {
    return await this.workboard.transitionItem(params);
  }

  async listTaskRows(params: { scope: WorkScope; work_item_id: string }) {
    const rows = await loadTaskRows(this.db, params.scope, params.work_item_id);
    return rows.map(
      (row) =>
        ({
          task_id: row.task_id,
          status: row.status as WorkboardTaskRow["status"],
          execution_profile: row.execution_profile,
          approval_id: row.approval_id ?? undefined,
          lease_owner: row.lease_owner ?? undefined,
        }) satisfies WorkboardTaskRow,
    );
  }

  async listTasks(params: Parameters<WorkboardDal["listTasks"]>[0]) {
    return await this.workboard.listTasks(params);
  }

  async createTask(params: Parameters<WorkboardDal["createTask"]>[0]) {
    return await this.workboard.createTask(params);
  }

  async updateTask(params: Parameters<WorkboardDal["updateTask"]>[0]) {
    return await this.workboard.updateTask(params);
  }

  async leaseRunnableTasks(params: Parameters<WorkboardDal["leaseRunnableTasks"]>[0]) {
    return await this.workboard.leaseRunnableTasks(params);
  }

  async getStateKv(params: Parameters<WorkboardDal["getStateKv"]>[0]) {
    return await this.workboard.getStateKv(params);
  }

  async setStateKv(params: Parameters<WorkboardDal["setStateKv"]>[0]) {
    return await this.workboard.setStateKv(params);
  }

  async listStateKv(params: Parameters<WorkboardDal["listStateKv"]>[0]) {
    return await this.workboard.listStateKv(params);
  }

  async requeueOrphanedTasks(params: {
    scope: { tenant_id: string; agent_id: string; workspace_id: string };
    work_item_id: string;
    updated_at: string;
  }): Promise<void> {
    await this.db.run(
      `UPDATE work_item_tasks
       SET status = CASE
           WHEN status IN ('leased', 'running', 'paused') THEN 'queued'
           ELSE status
         END,
         lease_owner = NULL,
         lease_expires_at_ms = NULL,
         updated_at = ?
       WHERE tenant_id = ? AND work_item_id = ?`,
      [params.updated_at, params.scope.tenant_id, params.work_item_id],
    );
  }

  async listClarifications(params: Parameters<WorkboardDal["listClarifications"]>[0]) {
    return await this.workboard.listClarifications(params);
  }

  async createSubagent(params: Parameters<WorkboardRepository["createSubagent"]>[0]) {
    return await this.workboard.createSubagent(toGatewaySubagentCreateParams(params));
  }

  async listSubagents(params: Parameters<WorkboardRepository["listSubagents"]>[0]) {
    return await this.workboard.listSubagents(toGatewaySubagentListParams(params));
  }

  async getSubagent(params: Parameters<WorkboardRepository["getSubagent"]>[0]) {
    return await this.workboard.getSubagent(toGatewaySubagentGetParams(params));
  }

  async closeSubagent(params: Parameters<WorkboardDal["closeSubagent"]>[0]) {
    return await this.workboard.closeSubagent(params);
  }

  async markSubagentClosed(params: Parameters<WorkboardDal["markSubagentClosed"]>[0]) {
    return await this.workboard.markSubagentClosed(params);
  }

  async markSubagentFailed(params: Parameters<WorkboardDal["markSubagentFailed"]>[0]) {
    return await this.workboard.markSubagentFailed(params);
  }

  async updateSubagent(params: Parameters<WorkboardDal["updateSubagent"]>[0]) {
    return await this.workboard.updateSubagent(params);
  }

  async createLink(params: Parameters<WorkboardDal["createLink"]>[0]) {
    return WorkItemLink.parse(await this.workboard.createLink(params));
  }

  async listLinks(params: Parameters<WorkboardDal["listLinks"]>[0]) {
    const { links } = await this.workboard.listLinks(params);
    return { links: links.map((link) => WorkItemLink.parse(link)) };
  }

  async listArtifacts(params: Parameters<WorkboardDal["listArtifacts"]>[0]) {
    return await this.workboard.listArtifacts(params);
  }

  async getArtifact(params: Parameters<WorkboardDal["getArtifact"]>[0]) {
    return await this.workboard.getArtifact(params);
  }

  async createArtifact(params: Parameters<WorkboardDal["createArtifact"]>[0]) {
    return await this.workboard.createArtifact(params);
  }

  async listDecisions(params: Parameters<WorkboardDal["listDecisions"]>[0]) {
    return await this.workboard.listDecisions(params);
  }

  async getDecision(params: Parameters<WorkboardDal["getDecision"]>[0]) {
    return await this.workboard.getDecision(params);
  }

  async createDecision(params: Parameters<WorkboardDal["createDecision"]>[0]) {
    return await this.workboard.createDecision(params);
  }

  async listSignals(params: Parameters<WorkboardDal["listSignals"]>[0]) {
    return await this.workboard.listSignals(params);
  }

  async getSignal(params: Parameters<WorkboardDal["getSignal"]>[0]) {
    return await this.workboard.getSignal(params);
  }

  async createSignal(params: Parameters<WorkboardDal["createSignal"]>[0]) {
    return await this.workboard.createSignal(params);
  }

  async updateSignal(params: Parameters<WorkboardDal["updateSignal"]>[0]) {
    return await this.workboard.updateSignal(params);
  }

  async acquireExecutionSlot(params: {
    scope: { tenant_id: string; agent_id: string; workspace_id: string };
    task_id: string;
    owner: string;
    limit: number;
    nowMs?: number;
    ttlMs?: number;
  }): Promise<boolean> {
    const nowMs = params.nowMs ?? Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const scopeId = `${params.scope.agent_id}:${params.scope.workspace_id}`;
    return await this.db.transaction(
      async (tx) =>
        await tryAcquireConcurrencySlotTx(tx, {
          tenantId: params.scope.tenant_id,
          scope: "workboard.execution",
          scopeId,
          limit: params.limit,
          attemptId: params.task_id,
          owner: params.owner,
          nowMs,
          nowIso,
          ttlMs: Math.max(1_000, params.ttlMs ?? 60_000),
        }),
    );
  }

  async releaseExecutionSlot(params: {
    scope: { tenant_id: string; agent_id: string; workspace_id: string };
    task_id: string;
  }): Promise<void> {
    await this.db.run(
      `UPDATE concurrency_slots
       SET lease_owner = NULL,
           lease_expires_at_ms = NULL,
           attempt_id = NULL,
           updated_at = ?
       WHERE tenant_id = ?
         AND scope = 'workboard.execution'
         AND attempt_id = ?`,
      [new Date().toISOString(), params.scope.tenant_id, params.task_id],
    );
  }

  async createInterventionApproval(params: {
    scope: { tenant_id: string; agent_id: string; workspace_id: string };
    work_item_id: string;
    task_id: string;
    reason: string;
  }): Promise<{ approval_id: string } | undefined> {
    if (!this.opts.approvalDal) {
      return undefined;
    }

    const approval = await createReviewedApproval({
      approvalDal: this.opts.approvalDal,
      policyService: this.opts.policyService,
      emitUpdate: async (createdApproval) => {
        if (!this.opts.protocolDeps) {
          return;
        }
        await broadcastApprovalUpdated({
          tenantId: params.scope.tenant_id,
          approval: createdApproval,
          protocolDeps: this.opts.protocolDeps,
        });
      },
      params: {
        tenantId: params.scope.tenant_id,
        agentId: params.scope.agent_id,
        workspaceId: params.scope.workspace_id,
        approvalKey: `work.intervention:${params.work_item_id}:${params.task_id}`,
        kind: "work.intervention",
        prompt: `Manual intervention required for work item ${params.work_item_id}`,
        motivation: params.reason,
        context: {
          source: "workboard.reconciler",
          work_item_id: params.work_item_id,
          work_item_task_id: params.task_id,
          reason: params.reason,
        },
        workItemId: params.work_item_id,
        workItemTaskId: params.task_id,
      },
    });
    return { approval_id: approval.approval_id };
  }
}

export function createGatewayWorkboardRepository(opts: {
  db: SqlDb;
  redactionEngine?: RedactionEngine;
  approvalDal?: ApprovalDal;
  policyService?: PolicyService;
  protocolDeps?: ProtocolDeps;
}): GatewayWorkboardRepository {
  return new GatewayWorkboardRepository(opts.db, opts);
}

function createGatewayWorkboardServiceEffects(opts: {
  db: SqlDb;
  redactionEngine?: RedactionEngine;
  approvalDal?: ApprovalDal;
  policyService?: PolicyService;
  protocolDeps?: ProtocolDeps;
}): WorkboardServiceEffects {
  const workboard = new WorkboardDal(opts.db, opts.redactionEngine);
  return {
    emitItemEvent: async (params) =>
      await emitItemEvent({
        db: opts.db,
        redactionEngine: opts.redactionEngine,
        protocolDeps: opts.protocolDeps,
        type: params.type,
        item: params.item,
      }),
    notifyItemTransition: async (params) =>
      await maybeEnqueueStateChangeNotification({
        db: opts.db,
        scope: params.scope,
        item: params.item,
        approvalDal: opts.approvalDal,
        policyService: opts.policyService,
        protocolDeps: opts.protocolDeps,
      }),
    interruptSubagents: async (params) =>
      await interruptSubagents(opts.db, params.subagents, params.detail, params.createdAtMs),
    clearSubagentSignals: async (params) => await clearSubagentSignals(opts.db, params.subagents),
    resolvePendingInterventionApprovals: async (params) =>
      await completePendingInterventionApprovals({
        db: opts.db,
        scope: params.scope,
        workItemId: params.work_item_id,
        decision: params.decision,
        reason: params.reason,
        approvalDal: opts.approvalDal,
        protocolDeps: opts.protocolDeps,
      }),
    loadDeleteEffects: async (params) =>
      await loadDeleteEffects({
        db: opts.db,
        scope: params.scope,
        workItemId: params.work_item_id,
      }),
    emitDeleteEffects: async (params) =>
      await emitDeleteEffects({
        db: opts.db,
        workboard,
        scope: params.scope,
        childItemIds: params.childItemIds,
        attachedSignalIds: params.attachedSignalIds,
        redactionEngine: opts.redactionEngine,
        protocolDeps: opts.protocolDeps,
      }),
  };
}

export function createGatewayWorkboardService(opts: {
  db: SqlDb;
  redactionEngine?: RedactionEngine;
  approvalDal?: ApprovalDal;
  policyService?: PolicyService;
  protocolDeps?: ProtocolDeps;
}): RuntimeWorkboardService {
  return new RuntimeWorkboardService({
    repository: createGatewayWorkboardRepository(opts),
    effects: createGatewayWorkboardServiceEffects(opts),
  });
}

export function createGatewayConversationKeyBuilder(opts: {
  db: SqlDb;
  identityScopeDal?: IdentityScopeDal;
}): WorkboardConversationKeyBuilder {
  const identityScopeDal = opts.identityScopeDal ?? new IdentityScopeDal(opts.db);
  return {
    buildConversationKey: async (scope, subagentId) => {
      const agentKey = await resolveAgentKeyById({
        identityScopeDal,
        tenantId: scope.tenant_id,
        agentId: scope.agent_id,
      });
      return `agent:${agentKey}:subagent:${subagentId}`;
    },
  };
}

export function createGatewaySubagentRuntime(opts: {
  db: SqlDb;
  agents: AgentRegistry;
  identityScopeDal?: IdentityScopeDal;
}): WorkboardSubagentRuntime {
  const identityScopeDal = opts.identityScopeDal ?? new IdentityScopeDal(opts.db);
  return {
    ...createGatewayConversationKeyBuilder({ db: opts.db, identityScopeDal }),
    runTurn: ({ scope, subagent, message }) =>
      runSubagentTurn({
        agents: opts.agents,
        identityScopeDal,
        scope,
        subagent,
        message,
      }),
  };
}

export function createGatewayManagedDesktopProvisioner(opts: {
  db: SqlDb;
  defaultDeploymentConfig: DeploymentConfigT;
}): ManagedDesktopProvisioner {
  return {
    provisionManagedDesktop: async (input) =>
      await provisionManagedDesktop({
        db: opts.db,
        tenantId: input.tenantId,
        subagentConversationKey: input.subagentConversationKey,
        label: input.label,
        defaultDeploymentConfig: opts.defaultDeploymentConfig,
      }),
  };
}
