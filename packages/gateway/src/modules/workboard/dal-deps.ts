import type { WorkItem, WorkScope, WsEventEnvelope } from "@tyrum/contracts";
import type { SqlDb } from "../../statestore/types.js";

export type GetItemFn = (params: {
  scope: WorkScope;
  work_item_id: string;
}) => Promise<WorkItem | undefined>;

export type EnqueueWsEventTxFn = (tx: SqlDb, evt: WsEventEnvelope) => Promise<void>;
