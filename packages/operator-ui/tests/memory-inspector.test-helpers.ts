import React, { act } from "react";
import { expect, vi } from "vitest";
import type { MemoryItem } from "@tyrum/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import type { OperatorHttpClient, OperatorWsClient } from "../../operator-core/src/deps.js";
import { MemoryInspector } from "../src/index.js";
import {
  cleanupTestRoot,
  click,
  renderIntoDocument,
  setNativeValue,
  type TestRoot,
} from "./test-utils.js";

type Handler = (data: unknown) => void;

const DEFAULT_AGENT_ID = "default";
const DEFAULT_CREATED_AT = "2026-02-19T12:00:00Z";
const DEFAULT_PROVENANCE = { source_kind: "operator", refs: [] } as const;

export interface MemoryInspectorTestContext {
  http: OperatorHttpClient;
  testRoot: TestRoot;
  ws: FakeWsClient;
  cleanup: () => void;
}

export class FakeWsClient implements OperatorWsClient {
  connected = true;
  connect = vi.fn(() => {});
  disconnect = vi.fn(() => {});

  approvalList = vi.fn(async () => ({ approvals: [], next_cursor: undefined }));
  runList = vi.fn(async () => ({ runs: [], steps: [], attempts: [] }));
  approvalResolve = vi.fn(async () => ({ approval: { approval_id: 1 } as unknown }));

  memorySearch = vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined }) as unknown);
  memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
  memoryGet = vi.fn(async () => ({ v: 1, item: {} }) as unknown);
  memoryUpdate = vi.fn(async () => ({ v: 1, item: {} }) as unknown);
  memoryForget = vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] }) as unknown);
  memoryExport = vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" }) as unknown);

  private readonly handlers = new Map<string, Set<Handler>>();

  emit(event: string, data: unknown): void {
    const handlers = this.handlers.get(event);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(data);
    }
  }

  on(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (existing) {
      existing.add(handler);
      return;
    }
    this.handlers.set(event, new Set([handler]));
  }

  off(event: string, handler: Handler): void {
    const existing = this.handlers.get(event);
    if (!existing) {
      return;
    }
    existing.delete(handler);
    if (existing.size === 0) {
      this.handlers.delete(event);
    }
  }
}

export function createFakeHttpClient(): OperatorHttpClient {
  return {
    status: { get: vi.fn(async () => ({ status: "ok" }) as unknown) },
    usage: { get: vi.fn(async () => ({ status: "ok" }) as unknown) },
    presence: {
      list: vi.fn(async () => ({ status: "ok", generated_at: "", entries: [] }) as unknown),
    },
    pairings: {
      list: vi.fn(async () => ({ status: "ok", pairings: [] }) as unknown),
      approve: vi.fn(async () => ({ status: "ok" }) as unknown),
      deny: vi.fn(async () => ({ status: "ok" }) as unknown),
      revoke: vi.fn(async () => ({ status: "ok" }) as unknown),
    },
  };
}

function createBaseMemoryItem(memoryItemId: string, kind: MemoryItem["kind"], agentId: string) {
  return {
    v: 1,
    memory_item_id: memoryItemId,
    agent_id: agentId,
    kind,
    tags: ["demo"],
    sensitivity: "private",
    provenance: DEFAULT_PROVENANCE,
    created_at: DEFAULT_CREATED_AT,
  } satisfies Partial<MemoryItem>;
}

export function sampleNote(
  memoryItemId: string,
  body: string,
  agentId = DEFAULT_AGENT_ID,
): MemoryItem {
  return {
    ...createBaseMemoryItem(memoryItemId, "note", agentId),
    body_md: body,
  } as MemoryItem;
}

export function sampleProcedure(
  memoryItemId: string,
  body: string,
  agentId = DEFAULT_AGENT_ID,
): MemoryItem {
  return {
    ...createBaseMemoryItem(memoryItemId, "procedure", agentId),
    body_md: body,
  } as MemoryItem;
}

export function sampleEpisode(
  memoryItemId: string,
  summary: string,
  agentId = DEFAULT_AGENT_ID,
): MemoryItem {
  return {
    ...createBaseMemoryItem(memoryItemId, "episode", agentId),
    occurred_at: DEFAULT_CREATED_AT,
    summary_md: summary,
  } as MemoryItem;
}

export function sampleFact(
  memoryItemId: string,
  key: string,
  value: unknown,
  agentId = DEFAULT_AGENT_ID,
): MemoryItem {
  return {
    ...createBaseMemoryItem(memoryItemId, "fact", agentId),
    key,
    value,
    observed_at: DEFAULT_CREATED_AT,
    confidence: 0.9,
  } as MemoryItem;
}

export function sampleTombstone(
  item: MemoryItem,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    v: 1,
    memory_item_id: item.memory_item_id,
    agent_id: item.agent_id,
    deleted_at: "2026-02-19T12:00:02Z",
    deleted_by: "operator",
    reason: "test",
    ...overrides,
  };
}

export function createMemoryInspectorTestContext(
  options: {
    agentId?: string;
    http?: OperatorHttpClient;
    ws?: FakeWsClient;
  } = {},
): MemoryInspectorTestContext {
  const ws = options.ws ?? new FakeWsClient();
  const http = options.http ?? createFakeHttpClient();
  const core = createOperatorCore({
    wsUrl: "ws://example.test/ws",
    httpBaseUrl: "http://example.test",
    auth: createBearerTokenAuth("test"),
    deps: { ws, http },
  });
  const testRoot = renderIntoDocument(
    React.createElement(MemoryInspector, {
      core,
      ...(options.agentId ? { agentId: options.agentId } : {}),
    }),
  );
  return {
    ws,
    http,
    testRoot,
    cleanup: () => cleanupTestRoot(testRoot),
  };
}

export async function mountMemoryInspector(
  options: {
    agentId?: string;
    http?: OperatorHttpClient;
    ws?: FakeWsClient;
  } = {},
): Promise<MemoryInspectorTestContext> {
  const context = createMemoryInspectorTestContext(options);
  await flushMemoryInspector();
  return context;
}

export async function flushMemoryInspector(): Promise<void> {
  await act(async () => {});
}

export function expectElement<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  expect(element).not.toBeNull();
  return element!;
}

export async function clickElement(element: HTMLElement): Promise<void> {
  await act(async () => {
    click(element);
  });
}

export async function setFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  await act(async () => {
    setNativeValue(element, value);
  });
}

export async function selectMemoryItem(
  container: HTMLElement,
  memoryItemId: string,
): Promise<HTMLButtonElement> {
  const button = expectElement<HTMLButtonElement>(
    container,
    `[data-testid="memory-item-${memoryItemId}"]`,
  );
  await clickElement(button);
  return button;
}

export async function emitWsEvent(ws: FakeWsClient, event: string, data: unknown): Promise<void> {
  await act(async () => {
    ws.emit(event, data);
  });
}

export async function openFilters(container: HTMLElement): Promise<void> {
  const buttons = container.querySelectorAll<HTMLButtonElement>("button");
  for (const button of buttons) {
    if (button.textContent?.trim() === "Filters") {
      await clickElement(button);
      return;
    }
  }
  throw new Error('Unable to find "Filters" toggle');
}
