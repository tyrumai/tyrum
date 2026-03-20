import type { WorkScope } from "@tyrum/contracts";
import type { PolicyService } from "@tyrum/runtime-policy";
import type { SqlDb } from "../../statestore/types.js";
import type { ProtocolDeps } from "../../ws/protocol/types.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { RedactionEngine } from "../redaction/engine.js";
import { WorkboardDal } from "./dal.js";
import {
  assertItemMutable,
  cancelPausedTasks,
  closePausedSubagents,
  completePendingInterventionApprovals,
  createCapturedWorkItem,
  emitItemEvent,
  getTransitionEventType,
  interruptSubagents,
  loadTaskRows,
  maybeEnqueueStateChangeNotification,
} from "./service-support.js";

export class GatewayWorkboardService {
  private readonly workboard: WorkboardDal;

  constructor(
    private readonly opts: {
      db: SqlDb;
      redactionEngine?: RedactionEngine;
      approvalDal?: ApprovalDal;
      policyService?: PolicyService;
      protocolDeps?: ProtocolDeps;
    },
  ) {
    this.workboard = new WorkboardDal(opts.db, opts.redactionEngine);
  }

  async createItem(params: {
    scope: WorkScope;
    item: Parameters<WorkboardDal["createItem"]>[0]["item"];
    createdFromSessionKey?: string;
    captureEvent?: {
      kind?: string;
      payload_json?: unknown;
    };
  }) {
    return await createCapturedWorkItem({
      workboard: this.workboard,
      db: this.opts.db,
      redactionEngine: this.opts.redactionEngine,
      protocolDeps: this.opts.protocolDeps,
      scope: params.scope,
      item: params.item,
      createdFromSessionKey: params.createdFromSessionKey,
      captureEvent: params.captureEvent,
    });
  }

  async listItems(params: Parameters<WorkboardDal["listItems"]>[0]) {
    return await this.workboard.listItems(params);
  }

  async getItem(params: Parameters<WorkboardDal["getItem"]>[0]) {
    return await this.workboard.getItem(params);
  }

  async updateItem(params: Parameters<WorkboardDal["updateItem"]>[0]) {
    await assertItemMutable(this.opts.db, params.scope, params.work_item_id);
    const item = await this.workboard.updateItem(params);
    if (item) {
      await emitItemEvent({
        db: this.opts.db,
        redactionEngine: this.opts.redactionEngine,
        protocolDeps: this.opts.protocolDeps,
        type: "work.item.updated",
        item,
      });
    }
    return item;
  }

  async deleteItem(params: Parameters<WorkboardDal["deleteItem"]>[0]) {
    await assertItemMutable(this.opts.db, params.scope, params.work_item_id);
    await completePendingInterventionApprovals({
      db: this.opts.db,
      scope: params.scope,
      workItemId: params.work_item_id,
      decision: "denied",
      reason: "Work deleted by operator.",
      approvalDal: this.opts.approvalDal,
      protocolDeps: this.opts.protocolDeps,
    });
    await closePausedSubagents({
      db: this.opts.db,
      scope: params.scope,
      workItemId: params.work_item_id,
      reason: "Deleted by operator.",
      workboard: this.workboard,
    });
    await cancelPausedTasks({
      db: this.opts.db,
      scope: params.scope,
      workItemId: params.work_item_id,
      detail: "Deleted by operator.",
      workboard: this.workboard,
    });
    const item = await this.workboard.deleteItem(params);
    if (item) {
      await emitItemEvent({
        db: this.opts.db,
        redactionEngine: this.opts.redactionEngine,
        protocolDeps: this.opts.protocolDeps,
        type: "work.item.deleted",
        item,
      });
    }
    return item;
  }

  async pauseItem(params: { scope: WorkScope; work_item_id: string; reason?: string }) {
    const item = await this.workboard.getItem(params);
    if (!item) {
      return undefined;
    }

    const [subagents, tasks] = await Promise.all([
      this.workboard.listSubagents({
        scope: params.scope,
        work_item_id: params.work_item_id,
        statuses: ["running", "paused", "closing"],
        limit: 50,
      }),
      loadTaskRows(this.opts.db, params.scope, params.work_item_id),
    ]);
    const activeSubagents = subagents.subagents.filter(
      (subagent) => subagent.status === "running" || subagent.status === "closing",
    );
    const activeTasks = tasks.filter(
      (task) => task.status === "leased" || task.status === "running",
    );

    if (activeSubagents.length === 0 && activeTasks.length === 0) {
      if (
        subagents.subagents.some((subagent) => subagent.status === "paused") ||
        tasks.some((task) => task.status === "paused")
      ) {
        return item;
      }
      throw new Error("work item is not actively leased to an agent");
    }

    const pauseDetail = params.reason?.trim() || "Paused by operator.";
    const pauseReason = "manual";

    await interruptSubagents(this.opts.db, activeSubagents, pauseDetail);

    for (const subagent of activeSubagents) {
      await this.workboard.updateSubagent({
        scope: params.scope,
        subagent_id: subagent.subagent_id,
        patch: { status: "paused" },
      });
    }

    for (const task of activeTasks) {
      await this.workboard.updateTask({
        scope: params.scope,
        task_id: task.task_id,
        ...(task.lease_owner ? { lease_owner: task.lease_owner } : {}),
        patch: {
          status: "paused",
          approval_id: null,
          pause_reason: pauseReason,
          pause_detail: pauseDetail,
          result_summary: pauseDetail,
        },
      });
    }

    const hasPlannerOwnership =
      activeTasks.some((task) => task.execution_profile === "planner") ||
      activeSubagents.some((subagent) => subagent.execution_profile === "planner");

    if (hasPlannerOwnership) {
      await this.workboard.setStateKv({
        scope: { kind: "work_item", ...params.scope, work_item_id: params.work_item_id },
        key: "work.refinement.phase",
        value_json: "awaiting_human",
        provenance_json: { source: "work.pause" },
      });
      return await this.workboard.getItem(params);
    }

    await this.workboard.setStateKv({
      scope: { kind: "work_item", ...params.scope, work_item_id: params.work_item_id },
      key: "work.dispatch.phase",
      value_json: "awaiting_human",
      provenance_json: { source: "work.pause" },
    });

    if (item.status === "doing") {
      return await this.transitionItem({
        scope: params.scope,
        work_item_id: params.work_item_id,
        status: "blocked",
        reason: pauseDetail,
      });
    }

    return await this.workboard.getItem(params);
  }

  async resumeItem(params: { scope: WorkScope; work_item_id: string; reason?: string }) {
    const item = await this.workboard.getItem(params);
    if (!item) {
      return undefined;
    }

    const [subagents, tasks] = await Promise.all([
      this.workboard.listSubagents({
        scope: params.scope,
        work_item_id: params.work_item_id,
        statuses: ["paused"],
        limit: 50,
      }),
      loadTaskRows(this.opts.db, params.scope, params.work_item_id),
    ]);
    const pausedTasks = tasks.filter((task) => task.status === "paused");
    const pausedSubagents = subagents.subagents.filter((subagent) => subagent.status === "paused");

    if (pausedTasks.length === 0 && pausedSubagents.length === 0) {
      return item;
    }

    const resumeDetail = params.reason?.trim() || "Resumed by operator.";
    await closePausedSubagents({
      db: this.opts.db,
      scope: params.scope,
      workItemId: params.work_item_id,
      reason: resumeDetail,
      workboard: this.workboard,
    });
    const hasPlannerOwnership =
      pausedTasks.some((task) => task.execution_profile === "planner") ||
      pausedSubagents.some((subagent) => subagent.execution_profile === "planner");

    for (const task of pausedTasks) {
      await this.workboard.updateTask({
        scope: params.scope,
        task_id: task.task_id,
        patch: {
          status: "queued",
          approval_id: null,
          result_summary: resumeDetail,
        },
      });
    }

    if (hasPlannerOwnership) {
      if (!pausedTasks.some((task) => task.execution_profile === "planner")) {
        await this.workboard.createTask({
          scope: params.scope,
          task: {
            work_item_id: params.work_item_id,
            status: "queued",
            execution_profile: "planner",
            side_effect_class: "workspace",
            result_summary: resumeDetail,
          },
        });
      }
      await this.workboard.setStateKv({
        scope: { kind: "work_item", ...params.scope, work_item_id: params.work_item_id },
        key: "work.refinement.phase",
        value_json: "refining",
        provenance_json: { source: "work.resume" },
      });
      await completePendingInterventionApprovals({
        db: this.opts.db,
        scope: params.scope,
        workItemId: params.work_item_id,
        decision: "approved",
        reason: resumeDetail,
        approvalDal: this.opts.approvalDal,
        protocolDeps: this.opts.protocolDeps,
      });
      return await this.workboard.getItem(params);
    }

    await this.workboard.setStateKv({
      scope: { kind: "work_item", ...params.scope, work_item_id: params.work_item_id },
      key: "work.dispatch.phase",
      value_json: "unassigned",
      provenance_json: { source: "work.resume" },
    });

    if (!pausedTasks.some((task) => task.execution_profile !== "planner")) {
      await this.workboard.createTask({
        scope: params.scope,
        task: {
          work_item_id: params.work_item_id,
          status: "queued",
          execution_profile: "executor_rw",
          side_effect_class: "workspace",
          result_summary: resumeDetail,
        },
      });
    }

    if (item.status === "blocked") {
      const resumed = await this.transitionItem({
        scope: params.scope,
        work_item_id: params.work_item_id,
        status: "ready",
        reason: resumeDetail,
      });
      await completePendingInterventionApprovals({
        db: this.opts.db,
        scope: params.scope,
        workItemId: params.work_item_id,
        decision: "approved",
        reason: resumeDetail,
        approvalDal: this.opts.approvalDal,
        protocolDeps: this.opts.protocolDeps,
      });
      return resumed;
    }

    await completePendingInterventionApprovals({
      db: this.opts.db,
      scope: params.scope,
      workItemId: params.work_item_id,
      decision: "approved",
      reason: resumeDetail,
      approvalDal: this.opts.approvalDal,
      protocolDeps: this.opts.protocolDeps,
    });
    return await this.workboard.getItem(params);
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
    const scope = {
      tenant_id: params.tenantId,
      agent_id: params.agentId,
      workspace_id: params.workspaceId,
    } satisfies WorkScope;

    if (params.decision === "approved") {
      return await this.resumeItem({
        scope,
        work_item_id: params.work_item_id,
        reason: params.reason ?? "Intervention approved.",
      });
    }

    const detail = params.reason?.trim() || "Intervention denied.";
    await closePausedSubagents({
      db: this.opts.db,
      scope,
      workItemId: params.work_item_id,
      reason: detail,
      workboard: this.workboard,
    });
    await this.workboard.updateTask({
      scope,
      task_id: params.work_item_task_id,
      patch: {
        status: "cancelled",
        approval_id: null,
        result_summary: detail,
      },
    });
    await this.workboard.setStateKv({
      scope: { kind: "work_item", ...scope, work_item_id: params.work_item_id },
      key: "work.dispatch.phase",
      value_json: "cancelled",
      provenance_json: { source: "approval.resolve" },
    });
    const item = await this.workboard.getItem({ scope, work_item_id: params.work_item_id });
    if (!item) {
      return undefined;
    }
    if (item.status === "blocked" || item.status === "ready" || item.status === "doing") {
      return await this.transitionItemSystem({
        scope,
        work_item_id: params.work_item_id,
        status: "cancelled",
        reason: detail,
      });
    }
    return item;
  }

  async transitionItem(params: Parameters<WorkboardDal["transitionItem"]>[0]) {
    await assertItemMutable(this.opts.db, params.scope, params.work_item_id);
    return await this.transitionItemInternal(params);
  }

  async transitionItemSystem(params: Parameters<WorkboardDal["transitionItem"]>[0]) {
    return await this.transitionItemInternal(params);
  }

  private async transitionItemInternal(params: Parameters<WorkboardDal["transitionItem"]>[0]) {
    const item = await this.workboard.transitionItem(params);
    if (!item) {
      return undefined;
    }
    await emitItemEvent({
      db: this.opts.db,
      redactionEngine: this.opts.redactionEngine,
      protocolDeps: this.opts.protocolDeps,
      type: getTransitionEventType(params.status),
      item,
    });
    await maybeEnqueueStateChangeNotification({
      db: this.opts.db,
      scope: params.scope,
      item,
      approvalDal: this.opts.approvalDal,
      policyService: this.opts.policyService,
      protocolDeps: this.opts.protocolDeps,
    });
    return item;
  }

  async createLink(params: Parameters<WorkboardDal["createLink"]>[0]) {
    await assertItemMutable(this.opts.db, params.scope, params.work_item_id);
    return await this.workboard.createLink(params);
  }

  async listLinks(params: Parameters<WorkboardDal["listLinks"]>[0]) {
    return await this.workboard.listLinks(params);
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

  async getStateKv(params: Parameters<WorkboardDal["getStateKv"]>[0]) {
    return await this.workboard.getStateKv(params);
  }

  async listStateKv(params: Parameters<WorkboardDal["listStateKv"]>[0]) {
    return await this.workboard.listStateKv(params);
  }

  async setStateKv(params: Parameters<WorkboardDal["setStateKv"]>[0]) {
    return await this.workboard.setStateKv(params);
  }
}

export function createGatewayWorkboardService(opts: {
  db: SqlDb;
  redactionEngine?: RedactionEngine;
  approvalDal?: ApprovalDal;
  policyService?: PolicyService;
  protocolDeps?: ProtocolDeps;
}): GatewayWorkboardService {
  return new GatewayWorkboardService(opts);
}
