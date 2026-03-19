import type { WorkboardCrudRepository } from "./types.js";

export class WorkboardService {
  constructor(private readonly opts: { repository: WorkboardCrudRepository }) {}

  async createItem(params: Parameters<WorkboardCrudRepository["createItem"]>[0]) {
    return await this.opts.repository.createItem(params);
  }

  async listItems(params: Parameters<WorkboardCrudRepository["listItems"]>[0]) {
    return await this.opts.repository.listItems(params);
  }

  async getItem(params: Parameters<WorkboardCrudRepository["getItem"]>[0]) {
    return await this.opts.repository.getItem(params);
  }

  async updateItem(params: Parameters<WorkboardCrudRepository["updateItem"]>[0]) {
    return await this.opts.repository.updateItem(params);
  }

  async transitionItem(params: Parameters<WorkboardCrudRepository["transitionItem"]>[0]) {
    return await this.opts.repository.transitionItem(params);
  }

  async createLink(params: Parameters<WorkboardCrudRepository["createLink"]>[0]) {
    if (params.work_item_id === params.linked_work_item_id) {
      throw new Error("work item cannot link to itself");
    }
    return await this.opts.repository.createLink(params);
  }

  async listLinks(params: Parameters<WorkboardCrudRepository["listLinks"]>[0]) {
    return await this.opts.repository.listLinks(params);
  }

  async listArtifacts(params: Parameters<WorkboardCrudRepository["listArtifacts"]>[0]) {
    return await this.opts.repository.listArtifacts(params);
  }

  async getArtifact(params: Parameters<WorkboardCrudRepository["getArtifact"]>[0]) {
    return await this.opts.repository.getArtifact(params);
  }

  async createArtifact(params: Parameters<WorkboardCrudRepository["createArtifact"]>[0]) {
    return await this.opts.repository.createArtifact(params);
  }

  async listDecisions(params: Parameters<WorkboardCrudRepository["listDecisions"]>[0]) {
    return await this.opts.repository.listDecisions(params);
  }

  async getDecision(params: Parameters<WorkboardCrudRepository["getDecision"]>[0]) {
    return await this.opts.repository.getDecision(params);
  }

  async createDecision(params: Parameters<WorkboardCrudRepository["createDecision"]>[0]) {
    return await this.opts.repository.createDecision(params);
  }

  async listSignals(params: Parameters<WorkboardCrudRepository["listSignals"]>[0]) {
    return await this.opts.repository.listSignals(params);
  }

  async getSignal(params: Parameters<WorkboardCrudRepository["getSignal"]>[0]) {
    return await this.opts.repository.getSignal(params);
  }

  async createSignal(params: Parameters<WorkboardCrudRepository["createSignal"]>[0]) {
    return await this.opts.repository.createSignal(params);
  }

  async updateSignal(params: Parameters<WorkboardCrudRepository["updateSignal"]>[0]) {
    return await this.opts.repository.updateSignal(params);
  }

  async getStateKv(params: Parameters<WorkboardCrudRepository["getStateKv"]>[0]) {
    return await this.opts.repository.getStateKv(params);
  }

  async listStateKv(params: Parameters<WorkboardCrudRepository["listStateKv"]>[0]) {
    return await this.opts.repository.listStateKv(params);
  }

  async setStateKv(params: Parameters<WorkboardCrudRepository["setStateKv"]>[0]) {
    return await this.opts.repository.setStateKv(params);
  }
}
