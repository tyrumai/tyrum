import { WorkItemLink, type DeploymentConfig as DeploymentConfigT } from "@tyrum/contracts";
import {
  WorkboardService as RuntimeWorkboardService,
  type ManagedDesktopProvisioner,
  type WorkboardCrudRepository,
  type WorkboardRepository,
  type WorkboardSessionKeyBuilder,
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
import { createGatewayWorkboardService as createGatewayCrudWorkboardService } from "./service.js";
import { resolveAgentKeyById, runSubagentTurn } from "./subagent-runtime-support.js";

class GatewayWorkboardRepository implements WorkboardRepository, WorkboardCrudRepository {
  private readonly workboard: WorkboardDal;
  private readonly service: ReturnType<typeof createGatewayCrudWorkboardService>;

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
    this.service = createGatewayCrudWorkboardService({
      db,
      redactionEngine: opts.redactionEngine,
      approvalDal: opts.approvalDal,
      policyService: opts.policyService,
      protocolDeps: opts.protocolDeps,
    });
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
    return await this.service.createItem({
      scope: params.scope,
      item: {
        ...params.item,
        budgets: params.item.budgets ?? undefined,
      },
      createdFromSessionKey: params.createdFromSessionKey,
    });
  }

  async listItems(params: Parameters<WorkboardDal["listItems"]>[0]) {
    return await this.workboard.listItems(params);
  }

  async updateItem(params: Parameters<WorkboardDal["updateItem"]>[0]) {
    return await this.service.updateItem(params);
  }

  async transitionItem(params: Parameters<WorkboardDal["transitionItem"]>[0]) {
    return await this.service.transitionItemSystem(params);
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

  async createSubagent(params: Parameters<WorkboardDal["createSubagent"]>[0]) {
    return await this.workboard.createSubagent(params);
  }

  async listSubagents(params: Parameters<WorkboardDal["listSubagents"]>[0]) {
    return await this.workboard.listSubagents(params);
  }

  async getSubagent(params: Parameters<WorkboardDal["getSubagent"]>[0]) {
    return await this.workboard.getSubagent(params);
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
    return WorkItemLink.parse(await this.service.createLink(params));
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

export function createGatewayWorkboardCrudRepository(opts: {
  db: SqlDb;
  redactionEngine?: RedactionEngine;
  approvalDal?: ApprovalDal;
  policyService?: PolicyService;
  protocolDeps?: ProtocolDeps;
}): GatewayWorkboardRepository {
  return new GatewayWorkboardRepository(opts.db, opts);
}

export function createGatewayWorkboardService(opts: {
  db: SqlDb;
  redactionEngine?: RedactionEngine;
  approvalDal?: ApprovalDal;
  policyService?: PolicyService;
  protocolDeps?: ProtocolDeps;
}): RuntimeWorkboardService {
  return new RuntimeWorkboardService({
    repository: createGatewayWorkboardCrudRepository(opts),
  });
}

export function createGatewaySessionKeyBuilder(opts: {
  db: SqlDb;
  identityScopeDal?: IdentityScopeDal;
}): WorkboardSessionKeyBuilder {
  const identityScopeDal = opts.identityScopeDal ?? new IdentityScopeDal(opts.db);
  return {
    buildSessionKey: async (scope, subagentId) => {
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
    ...createGatewaySessionKeyBuilder({ db: opts.db, identityScopeDal }),
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
        subagentSessionKey: input.subagentSessionKey,
        subagentLane: input.subagentLane,
        label: input.label,
        defaultDeploymentConfig: opts.defaultDeploymentConfig,
      }),
  };
}
