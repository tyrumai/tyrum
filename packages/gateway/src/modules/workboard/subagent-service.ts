import {
  SubagentService as RuntimeSubagentService,
  type CreateSubagentParams,
} from "@tyrum/runtime-workboard";
import type { SqlDb } from "../../statestore/types.js";
import type { AgentRegistry } from "../agent/registry.js";
import {
  createGatewaySubagentRuntime,
  createGatewayWorkboardRepository,
} from "./runtime-workboard-adapters.js";

export class SubagentService {
  private readonly service: RuntimeSubagentService;

  constructor(opts: { db: SqlDb; agents?: AgentRegistry }) {
    this.service = new RuntimeSubagentService({
      repository: createGatewayWorkboardRepository(opts.db),
      runtime: opts.agents
        ? createGatewaySubagentRuntime({ db: opts.db, agents: opts.agents })
        : undefined,
    });
  }

  createSubagent(
    params: CreateSubagentParams,
  ): ReturnType<RuntimeSubagentService["createSubagent"]> {
    return this.service.createSubagent(params);
  }

  listSubagents(
    params: Parameters<RuntimeSubagentService["listSubagents"]>[0],
  ): ReturnType<RuntimeSubagentService["listSubagents"]> {
    return this.service.listSubagents(params);
  }

  getSubagent(
    params: Parameters<RuntimeSubagentService["getSubagent"]>[0],
  ): ReturnType<RuntimeSubagentService["getSubagent"]> {
    return this.service.getSubagent(params);
  }

  closeSubagent(
    params: Parameters<RuntimeSubagentService["closeSubagent"]>[0],
  ): ReturnType<RuntimeSubagentService["closeSubagent"]> {
    return this.service.closeSubagent(params);
  }

  markSubagentClosed(
    params: Parameters<RuntimeSubagentService["markSubagentClosed"]>[0],
  ): ReturnType<RuntimeSubagentService["markSubagentClosed"]> {
    return this.service.markSubagentClosed(params);
  }

  sendSubagentMessage(
    params: Parameters<RuntimeSubagentService["sendSubagentMessage"]>[0],
  ): ReturnType<RuntimeSubagentService["sendSubagentMessage"]> {
    return this.service.sendSubagentMessage(params);
  }

  spawnAndRunSubagent(
    params: Parameters<RuntimeSubagentService["spawnAndRunSubagent"]>[0],
  ): ReturnType<RuntimeSubagentService["spawnAndRunSubagent"]> {
    return this.service.spawnAndRunSubagent(params);
  }
}
