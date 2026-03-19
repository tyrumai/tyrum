import type { Approval } from "@tyrum/client";
import type { PolicyOverride } from "@tyrum/contracts";
import type { OperatorWsClient } from "../deps.js";
import { ElevatedModeRequiredError } from "../elevated-mode.js";
import { createStore, type ExternalStore } from "../store.js";
import {
  approvalUpdatedAt,
  isApprovalBlockedStatus,
  isApprovalHumanActionableStatus,
  isApprovalTerminalStatus,
} from "../review-status.js";

const ACTIVE_APPROVAL_LIMIT = 500;
const HISTORY_APPROVAL_LIMIT = 100;
const HISTORY_APPROVAL_STATUSES = ["approved", "denied", "expired", "cancelled"] as const;

export interface ApprovalsState {
  byId: Record<string, Approval>;
  blockedIds: string[];
  pendingIds: string[];
  historyIds: string[];
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
}

export interface ApprovalsStore extends ExternalStore<ApprovalsState> {
  refreshPending(): Promise<void>;
  resolve(input: ResolveApprovalInput): Promise<ResolveApprovalResult>;
}

export interface ResolveApprovalOverride {
  tool_id: string;
  pattern: string;
  workspace_id?: string;
}

export interface ResolveApprovalInput {
  approvalId: string;
  decision: "approved" | "denied";
  reason?: string;
  mode?: "once" | "always";
  overrides?: ResolveApprovalOverride[];
}

export interface ResolveApprovalResult {
  approval: Approval;
  createdOverrides?: PolicyOverride[];
}

type GetPrivilegedWsClient = () => OperatorWsClient | null;

function compareTimestampsDesc(left: string, right: string): number {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs !== rightMs) {
    return rightMs - leftMs;
  }
  if (left !== right) {
    return right.localeCompare(left);
  }
  return 0;
}

function compareApprovalsByCreatedDesc(left: Approval, right: Approval): number {
  return compareTimestampsDesc(left.created_at, right.created_at);
}

function compareApprovalsByHistoryDesc(left: Approval, right: Approval): number {
  const updatedCompare = compareTimestampsDesc(approvalUpdatedAt(left), approvalUpdatedAt(right));
  if (updatedCompare !== 0) {
    return updatedCompare;
  }
  return compareApprovalsByCreatedDesc(left, right);
}

function sortApprovalIds(
  approvalIds: string[],
  byId: Record<string, Approval>,
  compare: (left: Approval, right: Approval) => number,
): string[] {
  return [...new Set(approvalIds)]
    .filter((approvalId) => approvalId in byId)
    .toSorted((leftId, rightId) => {
      const left = byId[leftId]!;
      const right = byId[rightId]!;
      const result = compare(left, right);
      return result !== 0 ? result : leftId.localeCompare(rightId);
    });
}

function updateApprovalIds(
  currentIds: string[],
  approvalId: string,
  shouldInclude: boolean,
): string[] {
  const nextIds = currentIds.filter((entry) => entry !== approvalId);
  if (shouldInclude) {
    nextIds.push(approvalId);
  }
  return nextIds;
}

function dedupeApprovals(approvals: Approval[]): Approval[] {
  const approvalsById = new Map<string, Approval>();
  for (const approval of approvals) {
    approvalsById.set(approval.approval_id, approval);
  }
  return [...approvalsById.values()];
}

function collectApprovalIds(
  approvals: Approval[],
): Pick<ApprovalsState, "blockedIds" | "pendingIds" | "historyIds"> {
  const byId = Object.fromEntries(
    approvals.map((approval) => [approval.approval_id, approval] as const),
  ) as Record<string, Approval>;

  return {
    blockedIds: sortApprovalIds(
      approvals
        .filter((approval) => isApprovalBlockedStatus(approval.status))
        .map((approval) => approval.approval_id),
      byId,
      compareApprovalsByCreatedDesc,
    ),
    pendingIds: sortApprovalIds(
      approvals
        .filter((approval) => isApprovalHumanActionableStatus(approval.status))
        .map((approval) => approval.approval_id),
      byId,
      compareApprovalsByCreatedDesc,
    ),
    historyIds: sortApprovalIds(
      approvals
        .filter((approval) => isApprovalTerminalStatus(approval.status))
        .map((approval) => approval.approval_id),
      byId,
      compareApprovalsByHistoryDesc,
    ).slice(0, HISTORY_APPROVAL_LIMIT),
  };
}

function upsertApproval(state: ApprovalsState, approval: Approval): ApprovalsState {
  const id = approval.approval_id;
  const byId = { ...state.byId, [id]: approval };
  const blockedIds = sortApprovalIds(
    updateApprovalIds(state.blockedIds, id, isApprovalBlockedStatus(approval.status)),
    byId,
    compareApprovalsByCreatedDesc,
  );
  const pendingIds = sortApprovalIds(
    updateApprovalIds(state.pendingIds, id, isApprovalHumanActionableStatus(approval.status)),
    byId,
    compareApprovalsByCreatedDesc,
  );
  const historyIds = sortApprovalIds(
    updateApprovalIds(state.historyIds, id, isApprovalTerminalStatus(approval.status)),
    byId,
    compareApprovalsByHistoryDesc,
  ).slice(0, HISTORY_APPROVAL_LIMIT);

  return { ...state, byId, blockedIds, pendingIds, historyIds };
}

async function withPrivilegedWsClient<T>(
  getPrivilegedWs: GetPrivilegedWsClient,
  fn: (ws: OperatorWsClient) => Promise<T>,
): Promise<T> {
  const ws = getPrivilegedWs();
  if (!ws) {
    throw new ElevatedModeRequiredError("Authorize admin access to resolve approvals.");
  }

  const alreadyConnected = ws.connected === true;
  if (!alreadyConnected) {
    await new Promise<void>((resolve, reject) => {
      const onConnected = () => {
        ws.off("connected", onConnected);
        ws.off("disconnected", onDisconnected);
        ws.off("transport_error", onTransportError);
        resolve();
      };
      const onDisconnected = () => {
        ws.off("connected", onConnected);
        ws.off("disconnected", onDisconnected);
        ws.off("transport_error", onTransportError);
        reject(new Error("Admin approval connection closed before it became ready."));
      };
      const onTransportError = (event: { message: string }) => {
        ws.off("connected", onConnected);
        ws.off("disconnected", onDisconnected);
        ws.off("transport_error", onTransportError);
        reject(new Error(event.message));
      };

      ws.on("connected", onConnected);
      ws.on("disconnected", onDisconnected);
      ws.on("transport_error", onTransportError);
      ws.connect();
    });
  }

  try {
    return await fn(ws);
  } finally {
    if (!alreadyConnected) {
      ws.disconnect();
    }
  }
}

export function createApprovalsStore(options: {
  ws: OperatorWsClient;
  getPrivilegedWs?: GetPrivilegedWsClient;
}): {
  store: ApprovalsStore;
  handleApprovalUpsert: (approval: Approval) => void;
} {
  const ws = options.ws;
  const { store, setState } = createStore<ApprovalsState>({
    byId: {},
    blockedIds: [],
    pendingIds: [],
    historyIds: [],
    loading: false,
    error: null,
    lastSyncedAt: null,
  });

  let refreshPendingRunId = 0;
  let activeRefreshPendingRunId: number | null = null;
  let bufferedApprovalUpserts = new Map<string, Approval>();

  function handleApprovalUpsert(approval: Approval): void {
    if (activeRefreshPendingRunId !== null) {
      bufferedApprovalUpserts.set(approval.approval_id, approval);
    }
    setState((prev) => upsertApproval(prev, approval));
  }

  async function refreshPending(): Promise<void> {
    const runId = ++refreshPendingRunId;
    activeRefreshPendingRunId = runId;
    bufferedApprovalUpserts = new Map<string, Approval>();

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [activeApprovalsResult, ...historyResults] = await Promise.all([
        ws.approvalList({ limit: ACTIVE_APPROVAL_LIMIT }),
        ...HISTORY_APPROVAL_STATUSES.map((status) =>
          ws.approvalList({ status, limit: HISTORY_APPROVAL_LIMIT }),
        ),
      ]);
      if (activeRefreshPendingRunId !== runId) return;
      const buffered = bufferedApprovalUpserts;
      const fetchedApprovals = dedupeApprovals([
        ...activeApprovalsResult.approvals,
        ...historyResults.flatMap((result) => result.approvals),
      ]);

      setState((prev) => {
        const byId = { ...prev.byId };
        for (const approval of fetchedApprovals) {
          byId[approval.approval_id] = approval;
        }

        let next: ApprovalsState = {
          ...prev,
          byId,
          ...collectApprovalIds(fetchedApprovals),
        };
        for (const approval of buffered.values()) {
          next = upsertApproval(next, approval);
        }
        return {
          ...next,
          loading: false,
          lastSyncedAt: new Date().toISOString(),
        };
      });
    } catch (error) {
      if (activeRefreshPendingRunId !== runId) return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      if (activeRefreshPendingRunId === runId) {
        activeRefreshPendingRunId = null;
        bufferedApprovalUpserts = new Map<string, Approval>();
      }
    }
  }

  async function resolve(input: ResolveApprovalInput): Promise<ResolveApprovalResult> {
    const resolveWithWs = async (client: OperatorWsClient) =>
      await client.approvalResolve({
        approval_id: input.approvalId,
        decision: input.decision,
        reason: input.reason,
        mode: input.mode,
        overrides: input.overrides,
      });
    const result = options.getPrivilegedWs
      ? await withPrivilegedWsClient(options.getPrivilegedWs, resolveWithWs)
      : await resolveWithWs(ws);
    const approval = result.approval;
    handleApprovalUpsert(approval);
    return {
      approval,
      createdOverrides: result.created_overrides,
    };
  }

  return {
    store: {
      ...store,
      refreshPending,
      resolve,
    },
    handleApprovalUpsert,
  };
}
