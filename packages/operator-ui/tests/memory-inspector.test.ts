// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import type { OperatorHttpClient, OperatorWsClient } from "../../operator-core/src/deps.js";
import type { MemoryItem } from "@tyrum/client";
import { cleanupTestRoot, renderIntoDocument } from "./test-utils.js";
import { MemoryInspector } from "../src/index.js";

type Handler = (data: unknown) => void;

class FakeWsClient implements OperatorWsClient {
  connected = true;
  connect = vi.fn(() => {});
  disconnect = vi.fn(() => {});
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
    if (!existing) return;
    existing.delete(handler);
    if (existing.size === 0) {
      this.handlers.delete(event);
    }
  }

  approvalList = vi.fn(async () => ({ approvals: [], next_cursor: undefined }));
  approvalResolve = vi.fn(async () => ({ approval: { approval_id: 1 } as unknown }));

  memorySearch = vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined }) as unknown);
  memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
  memoryGet = vi.fn(async () => ({ v: 1, item: {} }) as unknown);
  memoryUpdate = vi.fn(async () => ({ v: 1, item: {} }) as unknown);
  memoryForget = vi.fn(async () => ({ v: 1, deleted_count: 0, tombstones: [] }) as unknown);
  memoryExport = vi.fn(async () => ({ v: 1, artifact_id: "artifact-1" }) as unknown);

  private readonly handlers = new Map<string, Set<Handler>>();
}

function createFakeHttpClient(): OperatorHttpClient {
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

function sampleNote(memoryItemId: string, body: string): MemoryItem {
  return {
    v: 1,
    memory_item_id: memoryItemId,
    agent_id: "agent-1",
    kind: "note",
    tags: ["demo"],
    sensitivity: "private",
    provenance: { source_kind: "operator", refs: [] },
    created_at: "2026-02-19T12:00:00Z",
    body_md: body,
  };
}

describe("MemoryInspector", () => {
  it("lists memory items on mount", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174222", "Hello");

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const testRoot = renderIntoDocument(React.createElement(MemoryInspector, { core }));

    await act(async () => {});

    expect(ws.memoryList).toHaveBeenCalled();
    const snippet = testRoot.container.querySelector<HTMLDivElement>(
      `[data-testid="memory-item-snippet-${item.memory_item_id}"]`,
    );
    expect(snippet).not.toBeNull();
    expect(snippet?.textContent).toContain("Hello");

    const provenance = testRoot.container.querySelector<HTMLDivElement>(
      `[data-testid="memory-item-provenance-${item.memory_item_id}"]`,
    );
    expect(provenance).not.toBeNull();
    expect(provenance?.textContent).toContain("operator");

    cleanupTestRoot(testRoot);
  });

  it("inspects a memory item when selected", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174223", "Inspect body");

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const testRoot = renderIntoDocument(React.createElement(MemoryInspector, { core }));

    await act(async () => {});

    const itemButton = testRoot.container.querySelector<HTMLButtonElement>(
      `[data-testid="memory-item-${item.memory_item_id}"]`,
    );
    expect(itemButton).not.toBeNull();

    await act(async () => {
      itemButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(ws.memoryGet).toHaveBeenCalledWith({ v: 1, memory_item_id: item.memory_item_id });
    expect(testRoot.container.textContent).toContain("Inspect body");

    cleanupTestRoot(testRoot);
  });

  it("updates a memory item body", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174224", "Before");
    const updated: MemoryItem = { ...item, body_md: "After", updated_at: "2026-02-19T12:00:01Z" };

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);
    ws.memoryUpdate = vi.fn(async () => ({ v: 1, item: updated }) as unknown);

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const testRoot = renderIntoDocument(React.createElement(MemoryInspector, { core }));
    await act(async () => {});

    const itemButton = testRoot.container.querySelector<HTMLButtonElement>(
      `[data-testid="memory-item-${item.memory_item_id}"]`,
    );
    expect(itemButton).not.toBeNull();

    await act(async () => {
      itemButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const bodyField = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="memory-edit-body"]',
    );
    expect(bodyField).not.toBeNull();

    await act(async () => {
      bodyField!.value = "After";
      bodyField!.dispatchEvent(new Event("input", { bubbles: true }));
      bodyField!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const saveButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-save"]',
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(ws.memoryUpdate).toHaveBeenCalledWith({
      v: 1,
      memory_item_id: item.memory_item_id,
      patch: { body_md: "After" },
    });
    const updatedBodyField = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="memory-edit-body"]',
    );
    expect(updatedBodyField?.value).toBe("After");

    cleanupTestRoot(testRoot);
  });

  it("forgets a memory item with explicit confirmation and shows tombstone", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174225", "Forget me");

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);
    ws.memoryForget = vi.fn(async () => ({
      v: 1,
      deleted_count: 1,
      tombstones: [
        {
          v: 1,
          memory_item_id: item.memory_item_id,
          agent_id: item.agent_id,
          deleted_at: "2026-02-19T12:00:02Z",
          deleted_by: "operator",
          reason: "test",
        },
      ],
    }));

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const testRoot = renderIntoDocument(React.createElement(MemoryInspector, { core }));
    await act(async () => {});

    const itemButton = testRoot.container.querySelector<HTMLButtonElement>(
      `[data-testid="memory-item-${item.memory_item_id}"]`,
    );
    expect(itemButton).not.toBeNull();

    await act(async () => {
      itemButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const forgetButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-forget"]',
    );
    expect(forgetButton).not.toBeNull();

    await act(async () => {
      forgetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const confirmField = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="memory-forget-confirm"]',
    );
    expect(confirmField).not.toBeNull();

    await act(async () => {
      confirmField!.value = "FORGET";
      confirmField!.dispatchEvent(new Event("input", { bubbles: true }));
      confirmField!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const confirmButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-forget-submit"]',
    );
    expect(confirmButton).not.toBeNull();

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(ws.memoryForget).toHaveBeenCalledWith({
      v: 1,
      confirm: "FORGET",
      selectors: [{ kind: "id", memory_item_id: item.memory_item_id }],
    });

    expect(testRoot.container.textContent).toContain("tombstone");
    expect(testRoot.container.textContent).toContain(item.memory_item_id);

    cleanupTestRoot(testRoot);
  });

  it("exports memory and shows a download link", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174226", "Export me");

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryExport = vi.fn(async () => ({ v: 1, artifact_id: "artifact-999" }) as unknown);

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const testRoot = renderIntoDocument(React.createElement(MemoryInspector, { core }));
    await act(async () => {});

    const exportButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-export"]',
    );
    expect(exportButton).not.toBeNull();

    await act(async () => {
      exportButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(ws.memoryExport).toHaveBeenCalledWith({
      v: 1,
      filter: undefined,
      include_tombstones: false,
    });

    const link = testRoot.container.querySelector<HTMLAnchorElement>(
      '[data-testid="memory-export-download"]',
    );
    expect(link?.getAttribute("href")).toBe("http://example.test/memory/exports/artifact-999");

    cleanupTestRoot(testRoot);
  });

  it("searches memory using query + filters", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
    ws.memorySearch = vi.fn(async () => ({ v: 1, hits: [], next_cursor: undefined }) as unknown);

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const testRoot = renderIntoDocument(React.createElement(MemoryInspector, { core }));
    await act(async () => {});

    const searchMode = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-mode-search"]',
    );
    expect(searchMode).not.toBeNull();

    await act(async () => {
      searchMode?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const queryField = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="memory-query"]',
    );
    expect(queryField).not.toBeNull();

    await act(async () => {
      queryField!.value = "hello";
      queryField!.dispatchEvent(new Event("input", { bubbles: true }));
      queryField!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const kindNote = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="memory-filter-kind-note"]',
    );
    expect(kindNote).not.toBeNull();

    await act(async () => {
      kindNote!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const tagsField = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="memory-filter-tags"]',
    );
    expect(tagsField).not.toBeNull();

    await act(async () => {
      tagsField!.value = "demo";
      tagsField!.dispatchEvent(new Event("input", { bubbles: true }));
      tagsField!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const sourceOperator = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="memory-filter-provenance-source-operator"]',
    );
    expect(sourceOperator).not.toBeNull();

    await act(async () => {
      sourceOperator!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const channelField = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="memory-filter-provenance-channels"]',
    );
    expect(channelField).not.toBeNull();

    await act(async () => {
      channelField!.value = "cli";
      channelField!.dispatchEvent(new Event("input", { bubbles: true }));
      channelField!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const runButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-run"]',
    );
    expect(runButton).not.toBeNull();

    await act(async () => {
      runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(ws.memorySearch).toHaveBeenCalledWith(
      expect.objectContaining({
        v: 1,
        query: "hello",
        filter: expect.objectContaining({
          kinds: ["note"],
          tags: ["demo"],
          provenance: expect.objectContaining({ source_kinds: ["operator"], channels: ["cli"] }),
        }),
      }),
    );

    cleanupTestRoot(testRoot);
  });
});
