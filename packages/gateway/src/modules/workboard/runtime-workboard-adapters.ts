import type { DeploymentConfig as DeploymentConfigT } from "@tyrum/contracts";
import type {
  ManagedDesktopProvisioner,
  WorkboardRepository,
  WorkboardSessionKeyBuilder,
  WorkboardSubagentRuntime,
} from "@tyrum/runtime-workboard";
import type { SqlDb } from "../../statestore/types.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { SessionLaneNodeAttachmentDal } from "../agent/session-lane-node-attachment-dal.js";
import { WorkboardDal } from "./dal.js";
import { provisionManagedDesktop } from "./orchestration-support.js";
import { resolveAgentKeyById, runSubagentTurn } from "./subagent-runtime-support.js";

class GatewayWorkboardRepository implements WorkboardRepository {
  private readonly workboard: WorkboardDal;

  constructor(private readonly db: SqlDb) {
    this.workboard = new WorkboardDal(db);
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

  async transitionItem(params: Parameters<WorkboardDal["transitionItem"]>[0]) {
    return await this.workboard.transitionItem(params);
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
}

export function createGatewayWorkboardRepository(db: SqlDb): WorkboardRepository {
  return new GatewayWorkboardRepository(db);
}

export function createGatewaySessionKeyBuilder(opts: { db: SqlDb }): WorkboardSessionKeyBuilder {
  return {
    buildSessionKey: async (scope, subagentId) => {
      const agentKey = await resolveAgentKeyById({
        db: opts.db,
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
}): WorkboardSubagentRuntime {
  return {
    ...createGatewaySessionKeyBuilder(opts),
    runTurn: ({ scope, subagent, message }) =>
      runSubagentTurn({
        agents: opts.agents,
        db: opts.db,
        scope,
        subagent,
        message,
      }),
  };
}

export function createGatewayManagedDesktopProvisioner(opts: {
  db: SqlDb;
  sessionLaneNodeAttachmentDal: SessionLaneNodeAttachmentDal;
  defaultDeploymentConfig: DeploymentConfigT;
}): ManagedDesktopProvisioner {
  return {
    provisionManagedDesktop: async (input) =>
      await provisionManagedDesktop({
        db: opts.db,
        tenantId: input.tenantId,
        sessionLaneNodeAttachmentDal: opts.sessionLaneNodeAttachmentDal,
        subagentSessionKey: input.subagentSessionKey,
        subagentLane: input.subagentLane,
        label: input.label,
        defaultDeploymentConfig: opts.defaultDeploymentConfig,
      }),
  };
}
