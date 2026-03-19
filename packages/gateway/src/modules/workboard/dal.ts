import type { WsEventEnvelope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";
import type { RedactionEngine } from "../redaction/engine.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import { readRecordString } from "../util/coerce.js";

import * as dalHelpers from "./dal-helpers.js";
import { WorkboardItemRelationsDal } from "./item-relations-dal.js";
import { WorkboardItemTransitionsDal } from "./item-transitions-dal.js";
import { WorkboardItemsDal } from "./items-dal.js";
import { WorkboardClarificationsDal } from "./clarifications-dal.js";
import { WorkboardRecordsDal } from "./records-dal.js";
import { WorkboardScopeActivityDal } from "./scope-activity-dal.js";
import { WorkboardSignalsDal } from "./signals-dal.js";
import { WorkboardStateKvDal } from "./state-kv-dal.js";
import { WorkboardSubagentDal } from "./subagent-dal.js";
import { WorkboardTaskLeasingDal } from "./task-leasing-dal.js";
import { WorkboardTaskUpdatesDal } from "./task-updates-dal.js";
import { WorkboardTasksDal } from "./tasks-dal.js";

export type { WorkItemEventRow, WorkItemLinkRow, WorkScopeActivityRow } from "./dal-helpers.js";
export type { WorkboardTransitionErrorDetails } from "./dal-helpers.js";
export { WorkboardTransitionError } from "./dal-helpers.js";

export class WorkboardDal {
  private readonly items: WorkboardItemsDal;
  private readonly itemTransitions: WorkboardItemTransitionsDal;
  private readonly itemRelations: WorkboardItemRelationsDal;
  private readonly stateKv: WorkboardStateKvDal;
  private readonly tasks: WorkboardTasksDal;
  private readonly taskUpdates: WorkboardTaskUpdatesDal;
  private readonly taskLeasing: WorkboardTaskLeasingDal;
  private readonly subagents: WorkboardSubagentDal;
  private readonly clarifications: WorkboardClarificationsDal;
  private readonly records: WorkboardRecordsDal;
  private readonly scopeActivity: WorkboardScopeActivityDal;
  private readonly signals: WorkboardSignalsDal;

  constructor(
    db: SqlDb,
    private readonly redactionEngine?: RedactionEngine,
  ) {
    this.items = new WorkboardItemsDal(db);
    const getItem = (...args: Parameters<WorkboardItemsDal["getItem"]>) =>
      this.items.getItem(...args);
    this.itemTransitions = new WorkboardItemTransitionsDal(db);
    this.itemRelations = new WorkboardItemRelationsDal({ db, getItem });
    this.stateKv = new WorkboardStateKvDal({ db, getItem });
    this.tasks = new WorkboardTasksDal({ db, getItem });
    this.taskUpdates = new WorkboardTaskUpdatesDal({
      db,
      enqueueWsEventTx: (tx, evt) => this.enqueueWsEventTx(tx, evt),
    });
    this.taskLeasing = new WorkboardTaskLeasingDal({
      db,
      getItem,
      enqueueWsEventTx: (tx, evt) => this.enqueueWsEventTx(tx, evt),
    });
    this.subagents = new WorkboardSubagentDal({ db, getItem });
    this.clarifications = new WorkboardClarificationsDal({ db, getItem });
    this.records = new WorkboardRecordsDal({
      db,
      getItem,
      getSubagent: (...args) => this.subagents.getSubagent(...args),
    });
    this.scopeActivity = new WorkboardScopeActivityDal(db);
    this.signals = new WorkboardSignalsDal(db);
  }

  private async enqueueWsEventTx(tx: SqlDb, evt: WsEventEnvelope): Promise<void> {
    const payload = { message: evt, audience: dalHelpers.WORKBOARD_WS_AUDIENCE };
    const redactedPayload = this.redactionEngine
      ? this.redactionEngine.redactUnknown(payload).redacted
      : payload;
    const tenantId = readRecordString(evt.payload, "tenant_id") ?? DEFAULT_TENANT_ID;
    await tx.run(
      `INSERT INTO outbox (tenant_id, topic, target_edge_id, payload_json)
       VALUES (?, ?, ?, ?)`,
      [tenantId, "ws.broadcast", null, JSON.stringify(redactedPayload)],
    );
  }

  createItem(
    ...args: Parameters<WorkboardItemsDal["createItem"]>
  ): ReturnType<WorkboardItemsDal["createItem"]> {
    return this.items.createItem(...args);
  }

  getItem(
    ...args: Parameters<WorkboardItemsDal["getItem"]>
  ): ReturnType<WorkboardItemsDal["getItem"]> {
    return this.items.getItem(...args);
  }

  listItems(
    ...args: Parameters<WorkboardItemsDal["listItems"]>
  ): ReturnType<WorkboardItemsDal["listItems"]> {
    return this.items.listItems(...args);
  }

  updateItem(
    ...args: Parameters<WorkboardItemsDal["updateItem"]>
  ): ReturnType<WorkboardItemsDal["updateItem"]> {
    return this.items.updateItem(...args);
  }

  deleteItem(
    ...args: Parameters<WorkboardItemsDal["deleteItem"]>
  ): ReturnType<WorkboardItemsDal["deleteItem"]> {
    return this.items.deleteItem(...args);
  }

  transitionItem(
    ...args: Parameters<WorkboardItemTransitionsDal["transitionItem"]>
  ): ReturnType<WorkboardItemTransitionsDal["transitionItem"]> {
    return this.itemTransitions.transitionItem(...args);
  }

  appendEvent(
    ...args: Parameters<WorkboardItemRelationsDal["appendEvent"]>
  ): ReturnType<WorkboardItemRelationsDal["appendEvent"]> {
    return this.itemRelations.appendEvent(...args);
  }

  listEvents(
    ...args: Parameters<WorkboardItemRelationsDal["listEvents"]>
  ): ReturnType<WorkboardItemRelationsDal["listEvents"]> {
    return this.itemRelations.listEvents(...args);
  }

  getStateKv(
    ...args: Parameters<WorkboardStateKvDal["getStateKv"]>
  ): ReturnType<WorkboardStateKvDal["getStateKv"]> {
    return this.stateKv.getStateKv(...args);
  }

  listStateKv(
    ...args: Parameters<WorkboardStateKvDal["listStateKv"]>
  ): ReturnType<WorkboardStateKvDal["listStateKv"]> {
    return this.stateKv.listStateKv(...args);
  }

  setStateKv(
    ...args: Parameters<WorkboardStateKvDal["setStateKv"]>
  ): ReturnType<WorkboardStateKvDal["setStateKv"]> {
    return this.stateKv.setStateKv(...args);
  }

  deleteStateKv(
    ...args: Parameters<WorkboardStateKvDal["deleteStateKv"]>
  ): ReturnType<WorkboardStateKvDal["deleteStateKv"]> {
    return this.stateKv.deleteStateKv(...args);
  }

  createArtifact(
    ...args: Parameters<WorkboardRecordsDal["createArtifact"]>
  ): ReturnType<WorkboardRecordsDal["createArtifact"]> {
    return this.records.createArtifact(...args);
  }

  listArtifacts(
    ...args: Parameters<WorkboardRecordsDal["listArtifacts"]>
  ): ReturnType<WorkboardRecordsDal["listArtifacts"]> {
    return this.records.listArtifacts(...args);
  }

  getArtifact(
    ...args: Parameters<WorkboardRecordsDal["getArtifact"]>
  ): ReturnType<WorkboardRecordsDal["getArtifact"]> {
    return this.records.getArtifact(...args);
  }

  deleteArtifact(
    ...args: Parameters<WorkboardRecordsDal["deleteArtifact"]>
  ): ReturnType<WorkboardRecordsDal["deleteArtifact"]> {
    return this.records.deleteArtifact(...args);
  }

  createDecision(
    ...args: Parameters<WorkboardRecordsDal["createDecision"]>
  ): ReturnType<WorkboardRecordsDal["createDecision"]> {
    return this.records.createDecision(...args);
  }

  getDecision(
    ...args: Parameters<WorkboardRecordsDal["getDecision"]>
  ): ReturnType<WorkboardRecordsDal["getDecision"]> {
    return this.records.getDecision(...args);
  }

  listDecisions(
    ...args: Parameters<WorkboardRecordsDal["listDecisions"]>
  ): ReturnType<WorkboardRecordsDal["listDecisions"]> {
    return this.records.listDecisions(...args);
  }

  deleteDecision(
    ...args: Parameters<WorkboardRecordsDal["deleteDecision"]>
  ): ReturnType<WorkboardRecordsDal["deleteDecision"]> {
    return this.records.deleteDecision(...args);
  }

  createLink(
    ...args: Parameters<WorkboardItemRelationsDal["createLink"]>
  ): ReturnType<WorkboardItemRelationsDal["createLink"]> {
    return this.itemRelations.createLink(...args);
  }

  listLinks(
    ...args: Parameters<WorkboardItemRelationsDal["listLinks"]>
  ): ReturnType<WorkboardItemRelationsDal["listLinks"]> {
    return this.itemRelations.listLinks(...args);
  }

  createTask(
    ...args: Parameters<WorkboardTasksDal["createTask"]>
  ): ReturnType<WorkboardTasksDal["createTask"]> {
    return this.tasks.createTask(...args);
  }

  listTasks(
    ...args: Parameters<WorkboardTasksDal["listTasks"]>
  ): ReturnType<WorkboardTasksDal["listTasks"]> {
    return this.tasks.listTasks(...args);
  }

  getTask(
    ...args: Parameters<WorkboardTasksDal["getTask"]>
  ): ReturnType<WorkboardTasksDal["getTask"]> {
    return this.tasks.getTask(...args);
  }

  deleteTask(
    ...args: Parameters<WorkboardTasksDal["deleteTask"]>
  ): ReturnType<WorkboardTasksDal["deleteTask"]> {
    return this.tasks.deleteTask(...args);
  }

  updateTask(
    ...args: Parameters<WorkboardTaskUpdatesDal["updateTask"]>
  ): ReturnType<WorkboardTaskUpdatesDal["updateTask"]> {
    return this.taskUpdates.updateTask(...args);
  }

  leaseRunnableTasks(
    ...args: Parameters<WorkboardTaskLeasingDal["leaseRunnableTasks"]>
  ): ReturnType<WorkboardTaskLeasingDal["leaseRunnableTasks"]> {
    return this.taskLeasing.leaseRunnableTasks(...args);
  }

  createSubagent(
    ...args: Parameters<WorkboardSubagentDal["createSubagent"]>
  ): ReturnType<WorkboardSubagentDal["createSubagent"]> {
    return this.subagents.createSubagent(...args);
  }

  heartbeatSubagent(
    ...args: Parameters<WorkboardSubagentDal["heartbeatSubagent"]>
  ): ReturnType<WorkboardSubagentDal["heartbeatSubagent"]> {
    return this.subagents.heartbeatSubagent(...args);
  }

  getSubagent(
    ...args: Parameters<WorkboardSubagentDal["getSubagent"]>
  ): ReturnType<WorkboardSubagentDal["getSubagent"]> {
    return this.subagents.getSubagent(...args);
  }

  listSubagents(
    ...args: Parameters<WorkboardSubagentDal["listSubagents"]>
  ): ReturnType<WorkboardSubagentDal["listSubagents"]> {
    return this.subagents.listSubagents(...args);
  }

  closeSubagent(
    ...args: Parameters<WorkboardSubagentDal["closeSubagent"]>
  ): ReturnType<WorkboardSubagentDal["closeSubagent"]> {
    return this.subagents.closeSubagent(...args);
  }

  markSubagentClosed(
    ...args: Parameters<WorkboardSubagentDal["markSubagentClosed"]>
  ): ReturnType<WorkboardSubagentDal["markSubagentClosed"]> {
    return this.subagents.markSubagentClosed(...args);
  }

  markSubagentFailed(
    ...args: Parameters<WorkboardSubagentDal["markSubagentFailed"]>
  ): ReturnType<WorkboardSubagentDal["markSubagentFailed"]> {
    return this.subagents.markSubagentFailed(...args);
  }

  updateSubagent(
    ...args: Parameters<WorkboardSubagentDal["updateSubagent"]>
  ): ReturnType<WorkboardSubagentDal["updateSubagent"]> {
    return this.subagents.updateSubagent(...args);
  }

  deleteTerminatedSubagentsBefore(
    ...args: Parameters<WorkboardSubagentDal["deleteTerminatedSubagentsBefore"]>
  ): ReturnType<WorkboardSubagentDal["deleteTerminatedSubagentsBefore"]> {
    return this.subagents.deleteTerminatedSubagentsBefore(...args);
  }

  createClarification(
    ...args: Parameters<WorkboardClarificationsDal["createClarification"]>
  ): ReturnType<WorkboardClarificationsDal["createClarification"]> {
    return this.clarifications.createClarification(...args);
  }

  getClarification(
    ...args: Parameters<WorkboardClarificationsDal["getClarification"]>
  ): ReturnType<WorkboardClarificationsDal["getClarification"]> {
    return this.clarifications.getClarification(...args);
  }

  listClarifications(
    ...args: Parameters<WorkboardClarificationsDal["listClarifications"]>
  ): ReturnType<WorkboardClarificationsDal["listClarifications"]> {
    return this.clarifications.listClarifications(...args);
  }

  answerClarification(
    ...args: Parameters<WorkboardClarificationsDal["answerClarification"]>
  ): ReturnType<WorkboardClarificationsDal["answerClarification"]> {
    return this.clarifications.answerClarification(...args);
  }

  cancelClarification(
    ...args: Parameters<WorkboardClarificationsDal["cancelClarification"]>
  ): ReturnType<WorkboardClarificationsDal["cancelClarification"]> {
    return this.clarifications.cancelClarification(...args);
  }

  createSignal(
    ...args: Parameters<WorkboardSignalsDal["createSignal"]>
  ): ReturnType<WorkboardSignalsDal["createSignal"]> {
    return this.signals.createSignal(...args);
  }

  updateSignal(
    ...args: Parameters<WorkboardSignalsDal["updateSignal"]>
  ): ReturnType<WorkboardSignalsDal["updateSignal"]> {
    return this.signals.updateSignal(...args);
  }

  markSignalFired(
    ...args: Parameters<WorkboardSignalsDal["markSignalFired"]>
  ): ReturnType<WorkboardSignalsDal["markSignalFired"]> {
    return this.signals.markSignalFired(...args);
  }

  getSignal(
    ...args: Parameters<WorkboardSignalsDal["getSignal"]>
  ): ReturnType<WorkboardSignalsDal["getSignal"]> {
    return this.signals.getSignal(...args);
  }

  listSignals(
    ...args: Parameters<WorkboardSignalsDal["listSignals"]>
  ): ReturnType<WorkboardSignalsDal["listSignals"]> {
    return this.signals.listSignals(...args);
  }

  deleteSignal(
    ...args: Parameters<WorkboardSignalsDal["deleteSignal"]>
  ): ReturnType<WorkboardSignalsDal["deleteSignal"]> {
    return this.signals.deleteSignal(...args);
  }

  upsertScopeActivity(
    ...args: Parameters<WorkboardScopeActivityDal["upsertScopeActivity"]>
  ): ReturnType<WorkboardScopeActivityDal["upsertScopeActivity"]> {
    return this.scopeActivity.upsertScopeActivity(...args);
  }

  getScopeActivity(
    ...args: Parameters<WorkboardScopeActivityDal["getScopeActivity"]>
  ): ReturnType<WorkboardScopeActivityDal["getScopeActivity"]> {
    return this.scopeActivity.getScopeActivity(...args);
  }
}
