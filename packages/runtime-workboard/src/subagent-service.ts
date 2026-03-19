import { randomUUID } from "node:crypto";
import type { SubagentDescriptor, WorkScope } from "@tyrum/contracts";
import type {
  SubagentRepository,
  WorkboardSessionKeyBuilder,
  WorkboardSubagentRuntime,
} from "./types.js";

const TERMINAL_OR_CLOSING_SUBAGENT_STATUSES = new Set(["closing", "closed", "failed"]);

export type CreateSubagentParams = {
  scope: WorkScope;
  subagentId?: string;
  subagent: {
    execution_profile: string;
    session_key?: string;
    parent_session_key?: string;
    work_item_id?: string;
    work_item_task_id?: string;
    lane?: SubagentDescriptor["lane"];
    status?: SubagentDescriptor["status"];
    desktop_environment_id?: string;
    attached_node_id?: string;
  };
};

type ScopedSubagentParams = {
  scope: WorkScope;
  subagent_id: string;
  parent_session_key?: string;
};

export class SubagentService {
  constructor(
    private readonly opts: {
      repository: SubagentRepository;
      sessionKeyBuilder?: WorkboardSessionKeyBuilder;
      runtime?: WorkboardSubagentRuntime;
    },
  ) {}

  async createSubagent(params: CreateSubagentParams): Promise<SubagentDescriptor> {
    const subagentId = params.subagentId?.trim() || randomUUID();
    const sessionKey =
      params.subagent.session_key?.trim() || (await this.buildSessionKey(params.scope, subagentId));
    return await this.opts.repository.createSubagent({
      scope: params.scope,
      subagentId,
      subagent: {
        parent_session_key: params.subagent.parent_session_key,
        work_item_id: params.subagent.work_item_id,
        work_item_task_id: params.subagent.work_item_task_id,
        execution_profile: params.subagent.execution_profile,
        session_key: sessionKey,
        lane: params.subagent.lane,
        status: params.subagent.status,
        desktop_environment_id: params.subagent.desktop_environment_id,
        attached_node_id: params.subagent.attached_node_id,
      },
    });
  }

  async listSubagents(params: Parameters<SubagentRepository["listSubagents"]>[0]) {
    return await this.opts.repository.listSubagents(params);
  }

  async getSubagent(params: ScopedSubagentParams): Promise<SubagentDescriptor | undefined> {
    return await this.opts.repository.getSubagent(params);
  }

  async closeSubagent(params: {
    scope: WorkScope;
    subagent_id: string;
    parent_session_key?: string;
    reason?: string;
  }): Promise<SubagentDescriptor | undefined> {
    const subagent = await this.getSubagent(params);
    if (!subagent) {
      return undefined;
    }
    return await this.opts.repository.closeSubagent({
      scope: params.scope,
      subagent_id: params.subagent_id,
      reason: params.reason,
    });
  }

  async markSubagentClosed(params: {
    scope: WorkScope;
    subagent_id: string;
  }): Promise<SubagentDescriptor | undefined> {
    return await this.opts.repository.markSubagentClosed(params);
  }

  async sendSubagentMessage(params: {
    scope: WorkScope;
    subagent_id: string;
    message: string;
    parent_session_key?: string;
    subagent?: SubagentDescriptor;
  }): Promise<{ subagent: SubagentDescriptor; reply: string }> {
    const runtime = this.requireRuntime("sendSubagentMessage");
    const subagent =
      params.subagent ??
      (await this.getRequiredSubagent({
        scope: params.scope,
        subagent_id: params.subagent_id,
        parent_session_key: params.parent_session_key,
      }));
    if (TERMINAL_OR_CLOSING_SUBAGENT_STATUSES.has(subagent.status)) {
      throw new Error(`subagent is ${subagent.status}`);
    }

    if (subagent.status !== "running") {
      try {
        await this.opts.repository.updateSubagent({
          scope: params.scope,
          subagent_id: params.subagent_id,
          patch: { status: "running" },
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await this.opts.repository.markSubagentFailed({
          scope: params.scope,
          subagent_id: params.subagent_id,
          reason,
        });
        throw error;
      }
    }

    try {
      const reply = await runtime.runTurn({
        scope: params.scope,
        subagent,
        message: params.message,
      });
      return { subagent, reply };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.opts.repository.markSubagentFailed({
        scope: params.scope,
        subagent_id: params.subagent_id,
        reason,
      });
      throw error;
    }
  }

  async spawnAndRunSubagent(
    params: CreateSubagentParams & {
      message: string;
      close_on_success?: boolean;
    },
  ): Promise<{ subagent: SubagentDescriptor; reply: string }> {
    const runtime = this.requireRuntime("spawnAndRunSubagent");
    const subagent = await this.createSubagent(params);
    try {
      const reply = await runtime.runTurn({
        scope: params.scope,
        subagent,
        message: params.message,
      });
      const finalSubagent =
        params.close_on_success === true
          ? ((await this.opts.repository.markSubagentClosed({
              scope: params.scope,
              subagent_id: subagent.subagent_id,
            })) ?? subagent)
          : subagent;
      return {
        subagent: finalSubagent,
        reply,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.opts.repository.markSubagentFailed({
        scope: params.scope,
        subagent_id: subagent.subagent_id,
        reason,
      });
      throw error;
    }
  }

  private async buildSessionKey(scope: WorkScope, subagentId: string): Promise<string> {
    const sessionKeyBuilder = this.opts.sessionKeyBuilder ?? this.opts.runtime;
    if (!sessionKeyBuilder) {
      throw new Error("createSubagent requires session key builder");
    }
    return await sessionKeyBuilder.buildSessionKey(scope, subagentId);
  }

  private requireRuntime(method: string): WorkboardSubagentRuntime {
    if (!this.opts.runtime) {
      throw new Error(`${method} requires agent runtime access`);
    }
    return this.opts.runtime;
  }

  private async getRequiredSubagent(params: ScopedSubagentParams): Promise<SubagentDescriptor> {
    const subagent = await this.getSubagent(params);
    if (!subagent) {
      throw new Error("subagent not found");
    }
    return subagent;
  }
}
