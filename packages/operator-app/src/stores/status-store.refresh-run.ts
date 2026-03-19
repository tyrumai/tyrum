export interface RefreshRunState {
  runId: number;
  activeRunId: number | null;
}

export function beginRefresh(state: RefreshRunState): number {
  const runId = ++state.runId;
  state.activeRunId = runId;
  return runId;
}

export function isRefreshActive(state: RefreshRunState, runId: number): boolean {
  return state.activeRunId === runId;
}

export function endRefreshIfActive(state: RefreshRunState, runId: number): void {
  if (state.activeRunId === runId) {
    state.activeRunId = null;
  }
}
