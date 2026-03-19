import { act } from "react";
import { expect, type Mock, vi } from "vitest";
import type { OperatorCore } from "../../../operator-app/src/index.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected";

export const DEFAULT_SCOPE_KEYS = {
  agent_key: "default",
  workspace_key: "default",
} as const;

function createConnectionStore(status: ConnectionStatus) {
  const snapshot = { status, recovering: false };
  return {
    subscribe: (_listener: () => void) => () => {},
    getSnapshot: () => snapshot,
  };
}

function createWorkboardStore(snapshot?: Partial<Record<string, unknown>>) {
  let state = {
    items: [],
    tasksByWorkItemId: {},
    scopeKeys: { ...DEFAULT_SCOPE_KEYS },
    supported: null,
    loading: false,
    error: null,
    lastSyncedAt: null,
    ...snapshot,
  } as any;

  const listeners = new Set<() => void>();

  const store = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    refreshList: vi.fn(async () => {}),
    setScopeKeys: vi.fn((scopeKeys: Record<string, unknown>) => {
      state = {
        ...state,
        items: [],
        tasksByWorkItemId: {},
        scopeKeys: {
          agent_key:
            typeof scopeKeys.agent_key === "string" && scopeKeys.agent_key.trim().length > 0
              ? scopeKeys.agent_key.trim()
              : DEFAULT_SCOPE_KEYS.agent_key,
          workspace_key:
            typeof scopeKeys.workspace_key === "string" && scopeKeys.workspace_key.trim().length > 0
              ? scopeKeys.workspace_key.trim()
              : DEFAULT_SCOPE_KEYS.workspace_key,
        },
        error: null,
        lastSyncedAt: null,
      };
      for (const listener of listeners) listener();
    }),
    resetSupportProbe: vi.fn(() => {}),
    upsertWorkItem: (item: any) => {
      state = {
        ...state,
        items: (() => {
          const existingIndex = state.items.findIndex(
            (entry: any) => entry.work_item_id === item.work_item_id,
          );
          if (existingIndex === -1) return [...state.items, item];
          const next = state.items.slice();
          next[existingIndex] = item;
          return next;
        })(),
      };
      for (const listener of listeners) listener();
    },
  };

  return {
    store,
    setState: (updater: (prev: any) => any) => {
      state = updater(state);
      for (const listener of listeners) listener();
    },
  };
}

function createWsStub(overrides?: Partial<Record<string, unknown>>) {
  const handlers = new Map<string, Set<(event: any) => void>>();

  return {
    on: vi.fn((event: string, handler: (payload: any) => void) => {
      const existing = handlers.get(event) ?? new Set();
      existing.add(handler);
      handlers.set(event, existing);
    }),
    off: vi.fn((event: string, handler: (payload: any) => void) => {
      const existing = handlers.get(event);
      if (!existing) return;
      existing.delete(handler);
      if (existing.size === 0) handlers.delete(event);
    }),
    emit(event: string, payload: any) {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
    workList: vi.fn(async () => ({ items: [] })),
    workTransition: vi.fn(async ({ work_item_id, status }: any) => ({
      item: makeWorkItem({ work_item_id, status }),
    })),
    workGet: vi.fn(async ({ work_item_id }: any) => ({ item: makeWorkItem({ work_item_id }) })),
    workArtifactList: vi.fn(async () => ({ artifacts: [] })),
    workDecisionList: vi.fn(async () => ({ decisions: [] })),
    workSignalList: vi.fn(async () => ({ signals: [] })),
    workStateKvList: vi.fn(async () => ({ entries: [] })),
    workSignalGet: vi.fn(async ({ signal_id }: any) => ({
      signal: {
        signal_id,
        work_item_id: "wi-1",
        trigger_kind: "manual",
        status: "fired",
        created_at: "2026-01-01T00:00:00.000Z",
        last_fired_at: "2026-01-01T00:00:01.000Z",
        trigger_spec_json: { source: "event" },
      },
    })),
    workStateKvGet: vi.fn(async ({ key, scope }: any) => ({
      entry: { scope, key, value_json: { value: key } },
    })),
    ...overrides,
  };
}

export function makeWorkItem(partial: Partial<Record<string, unknown>> & { work_item_id: string }) {
  return {
    work_item_id: partial.work_item_id,
    title: "Ship regression tests",
    kind: "task",
    priority: 2,
    status: "backlog",
    acceptance: { done: true },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:05:00.000Z",
    last_active_at: "2026-01-01T00:10:00.000Z",
    ...partial,
  } as any;
}

export function createCore(
  status: ConnectionStatus,
  wsOverrides?: Partial<Record<string, unknown>>,
  workboardSnapshot?: Partial<Record<string, unknown>>,
) {
  const ws = createWsStub(wsOverrides);
  const workboard = createWorkboardStore(workboardSnapshot);
  const admin = {
    agents: {
      list: vi.fn(async () => ({
        agents: [{ agent_key: "default", persona: { name: "Default" } }],
      })),
    },
  };
  const core = {
    connectionStore: createConnectionStore(status),
    workboardStore: workboard.store,
    admin,
    http: admin,
    workboard: ws,
    chatSocket: ws,
    ws,
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as OperatorCore;
  return { core, ws, workboard, http: admin };
}

export async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export function clickButton(container: HTMLElement, label: string): void {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((el) =>
    el.textContent?.includes(label),
  );
  expect(button).not.toBeUndefined();
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

export function getStatusColumn(container: HTMLElement, label: string): HTMLElement {
  const column = container.querySelector<HTMLElement>(
    `[data-testid="workboard-column-${label.toLowerCase()}"]`,
  );
  expect(column).not.toBeNull();
  return column as HTMLElement;
}

export function expectDefaultScopeCall(spy: Mock, payload: Record<string, unknown>): void {
  expect(spy).toHaveBeenCalledWith({ ...DEFAULT_SCOPE_KEYS, ...payload });
}

export function expectStateScopeListCall(
  spy: Mock,
  nth: number,
  scope: Record<string, unknown>,
): void {
  expect(spy).toHaveBeenNthCalledWith(nth, { scope });
}

export function expectStateScopeGetCall(
  spy: Mock,
  nth: number,
  scope: Record<string, unknown>,
  key: string,
): void {
  expect(spy).toHaveBeenNthCalledWith(nth, { scope, key });
}
