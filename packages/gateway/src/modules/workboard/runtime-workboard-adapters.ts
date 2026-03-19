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
import type { SessionLaneNodeAttachmentDal } from "../agent/session-lane-node-attachment-dal.js";
import type { RedactionEngine } from "../redaction/engine.js";
import { WorkboardDal } from "./dal.js";
import { provisionManagedDesktop } from "./orchestration-support.js";
import { resolveAgentKeyById, runSubagentTurn } from "./subagent-runtime-support.js";

class GatewayWorkboardRepository implements WorkboardRepository, WorkboardCrudRepository {
  private readonly workboard: WorkboardDal;

  constructor(
    private readonly db: SqlDb,
    redactionEngine?: RedactionEngine,
  ) {
    this.workboard = new WorkboardDal(db, redactionEngine);
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

  async createItem(params: Parameters<WorkboardDal["createItem"]>[0]) {
    return await this.workboard.createItem(params);
  }

  async listItems(params: Parameters<WorkboardDal["listItems"]>[0]) {
    return await this.workboard.listItems(params);
  }

  async updateItem(params: Parameters<WorkboardDal["updateItem"]>[0]) {
    return await this.workboard.updateItem(params);
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
}

export function createGatewayWorkboardRepository(db: SqlDb): WorkboardRepository {
  return new GatewayWorkboardRepository(db);
}

export function createGatewayWorkboardCrudRepository(opts: {
  db: SqlDb;
  redactionEngine?: RedactionEngine;
}): WorkboardCrudRepository {
  return new GatewayWorkboardRepository(opts.db, opts.redactionEngine);
}

export function createGatewayWorkboardService(opts: {
  db: SqlDb;
  redactionEngine?: RedactionEngine;
}): RuntimeWorkboardService {
  return new RuntimeWorkboardService({
    repository: createGatewayWorkboardCrudRepository(opts),
  });
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
