import type { Approval } from "@tyrum/client";
import type { PolicyOverride } from "@tyrum/schemas";
import type { OperatorWsClient } from "../deps.js";
import { createStore, type ExternalStore } from "../store.js";

export interface ApprovalsState {
  byId: Record<string, Approval>;
  pendingIds: string[];
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
      const result = await ws.approvalList({ status: "pending", limit: 500 });
      if (activeRefreshPendingRunId !== runId) return;
      const buffered = bufferedApprovalUpserts;

      setState((prev) => {
        let next = prev;
        for (const approval of result.approvals) {
          next = upsertApproval(next, approval);
        }
        next = {
          ...next,
          pendingIds: result.approvals.map((approval) => approval.approval_id),
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
    const result = await ws.approvalResolve({
      approval_id: input.approvalId,
      decision: input.decision,
      reason: input.reason,
      mode: input.mode,
      overrides: input.overrides,
    });
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
