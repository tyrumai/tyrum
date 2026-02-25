import type { Approval } from "@tyrum/client";
import type { OperatorWsClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";

export interface ApprovalsState {
  byId: Record<number, Approval>;
  pendingIds: number[];
  loading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
}

export interface ApprovalsStore extends ExternalStore<ApprovalsState> {
  refreshPending(): Promise<void>;
  resolve(approvalId: number, decision: "approved" | "denied", reason?: string): Promise<Approval>;
}

function upsertApproval(state: ApprovalsState, approval: Approval): ApprovalsState {
  const id = approval.approval_id;
  const byId = { ...state.byId, [id]: approval };

  const shouldBePending = approval.status === "pending";
  const isPending = state.pendingIds.includes(id);
  let pendingIds = state.pendingIds;

  if (shouldBePending && !isPending) {
    pendingIds = [...pendingIds, id];
  } else if (!shouldBePending && isPending) {
    pendingIds = pendingIds.filter((entry) => entry !== id);
  }

  return { ...state, byId, pendingIds };
}

export function createApprovalsStore(ws: OperatorWsClient): {
  store: ApprovalsStore;
  handleApprovalUpsert: (approval: Approval) => void;
} {
  const { store, setState } = createStore<ApprovalsState>({
    byId: {},
    pendingIds: [],
    loading: false,
    error: null,
    lastSyncedAt: null,
  });

  function handleApprovalUpsert(approval: Approval): void {
    setState((prev) => upsertApproval(prev, approval));
  }

  async function refreshPending(): Promise<void> {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const result = await ws.approvalList({ status: "pending", limit: 500 });
      setState((prev) => {
        let next = prev;
        for (const approval of result.approvals) {
          next = upsertApproval(next, approval);
        }
        const pendingIds = result.approvals.map((approval) => approval.approval_id);
        return {
          ...next,
          pendingIds,
          loading: false,
          lastSyncedAt: new Date().toISOString(),
        };
      });
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function resolve(
    approvalId: number,
    decision: "approved" | "denied",
    reason?: string,
  ): Promise<Approval> {
    const result = await ws.approvalResolve({ approval_id: approvalId, decision, reason });
    const approval = result.approval;
    handleApprovalUpsert(approval);
    return approval;
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

