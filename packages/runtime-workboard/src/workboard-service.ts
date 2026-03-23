import {
  deleteWorkItem,
  pauseWorkItem,
  resolveInterventionApproval,
  resumeWorkItem,
} from "./workboard-service-operator-actions.js";
import { assertItemMutable, type WorkboardServiceDeps } from "./workboard-service-support.js";
import {
  transitionWorkItem,
  transitionWorkItemSystem,
} from "./workboard-service-transition-support.js";
import type { WorkboardServiceRepository } from "./types.js";

export class WorkboardService {
  constructor(private readonly opts: WorkboardServiceDeps) {}

  async createItem(params: Parameters<WorkboardServiceRepository["createItem"]>[0]) {
    return await this.opts.repository.createItem(params);
  }

  async listItems(params: Parameters<WorkboardServiceRepository["listItems"]>[0]) {
    return await this.opts.repository.listItems(params);
  }

  async getItem(params: Parameters<WorkboardServiceRepository["getItem"]>[0]) {
    return await this.opts.repository.getItem(params);
  }

  async updateItem(params: Parameters<WorkboardServiceRepository["updateItem"]>[0]) {
    await assertItemMutable(this.opts.repository, params.scope, params.work_item_id);
    const item = await this.opts.repository.updateItem(params);
    if (!item) {
      return undefined;
    }

    await this.opts.effects?.emitItemEvent?.({
      type: "work.item.updated",
      item,
    });
    return item;
  }

  async deleteItem(params: Parameters<WorkboardServiceRepository["deleteItem"]>[0]) {
    return await deleteWorkItem(this.opts, params);
  }

  async pauseItem(params: {
    scope: Parameters<WorkboardServiceRepository["getItem"]>[0]["scope"];
    work_item_id: string;
    reason?: string;
  }) {
    return await pauseWorkItem(this.opts, params);
  }

  async resumeItem(params: {
    scope: Parameters<WorkboardServiceRepository["getItem"]>[0]["scope"];
    work_item_id: string;
    reason?: string;
  }) {
    return await resumeWorkItem(this.opts, params);
  }

  async resolveInterventionApproval(params: {
    tenantId: string;
    agentId: string;
    workspaceId: string;
    work_item_id: string;
    work_item_task_id: string;
    decision: "approved" | "denied";
    reason?: string;
  }) {
    return await resolveInterventionApproval(this.opts, params);
  }

  async transitionItem(params: Parameters<WorkboardServiceRepository["transitionItem"]>[0]) {
    return await transitionWorkItem(this.opts, params);
  }

  async transitionItemSystem(params: Parameters<WorkboardServiceRepository["transitionItem"]>[0]) {
    return await transitionWorkItemSystem(this.opts, params);
  }

  async createLink(params: Parameters<WorkboardServiceRepository["createLink"]>[0]) {
    if (params.work_item_id === params.linked_work_item_id) {
      throw new Error("work item cannot link to itself");
    }

    await assertItemMutable(this.opts.repository, params.scope, params.work_item_id);
    return await this.opts.repository.createLink(params);
  }

  async listLinks(params: Parameters<WorkboardServiceRepository["listLinks"]>[0]) {
    return await this.opts.repository.listLinks(params);
  }

  async listArtifacts(params: Parameters<WorkboardServiceRepository["listArtifacts"]>[0]) {
    return await this.opts.repository.listArtifacts(params);
  }

  async getArtifact(params: Parameters<WorkboardServiceRepository["getArtifact"]>[0]) {
    return await this.opts.repository.getArtifact(params);
  }

  async createArtifact(params: Parameters<WorkboardServiceRepository["createArtifact"]>[0]) {
    return await this.opts.repository.createArtifact(params);
  }

  async listDecisions(params: Parameters<WorkboardServiceRepository["listDecisions"]>[0]) {
    return await this.opts.repository.listDecisions(params);
  }

  async getDecision(params: Parameters<WorkboardServiceRepository["getDecision"]>[0]) {
    return await this.opts.repository.getDecision(params);
  }

  async createDecision(params: Parameters<WorkboardServiceRepository["createDecision"]>[0]) {
    return await this.opts.repository.createDecision(params);
  }

  async listSignals(params: Parameters<WorkboardServiceRepository["listSignals"]>[0]) {
    return await this.opts.repository.listSignals(params);
  }

  async getSignal(params: Parameters<WorkboardServiceRepository["getSignal"]>[0]) {
    return await this.opts.repository.getSignal(params);
  }

  async createSignal(params: Parameters<WorkboardServiceRepository["createSignal"]>[0]) {
    return await this.opts.repository.createSignal(params);
  }

  async updateSignal(params: Parameters<WorkboardServiceRepository["updateSignal"]>[0]) {
    return await this.opts.repository.updateSignal(params);
  }

  async getStateKv(params: Parameters<WorkboardServiceRepository["getStateKv"]>[0]) {
    return await this.opts.repository.getStateKv(params);
  }

  async listStateKv(params: Parameters<WorkboardServiceRepository["listStateKv"]>[0]) {
    return await this.opts.repository.listStateKv(params);
  }

  async setStateKv(params: Parameters<WorkboardServiceRepository["setStateKv"]>[0]) {
    return await this.opts.repository.setStateKv(params);
  }
}
