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

function sampleProcedure(memoryItemId: string, body: string): MemoryItem {
  return {
    v: 1,
    memory_item_id: memoryItemId,
    agent_id: "agent-1",
    kind: "procedure",
    tags: ["demo"],
    sensitivity: "private",
    provenance: { source_kind: "operator", refs: [] },
    created_at: "2026-02-19T12:00:00Z",
    body_md: body,
  };
}

function sampleEpisode(memoryItemId: string, summary: string): MemoryItem {
  return {
    v: 1,
    memory_item_id: memoryItemId,
    agent_id: "agent-1",
    kind: "episode",
    tags: ["demo"],
    sensitivity: "private",
    provenance: { source_kind: "operator", refs: [] },
    created_at: "2026-02-19T12:00:00Z",
    occurred_at: "2026-02-19T12:00:00Z",
    summary_md: summary,
  };
}

function sampleFact(memoryItemId: string, key: string, value: unknown): MemoryItem {
  return {
    v: 1,
    memory_item_id: memoryItemId,
    agent_id: "agent-1",
    kind: "fact",
    tags: ["demo"],
    sensitivity: "private",
    provenance: { source_kind: "operator", refs: [] },
    created_at: "2026-02-19T12:00:00Z",
    key,
    value,
    observed_at: "2026-02-19T12:00:00Z",
    confidence: 0.9,
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

  it("shows procedure body in the detail view", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();
    const item = sampleProcedure("123e4567-e89b-12d3-a456-426614174227", "Procedure body");

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

    const bodyField = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="memory-edit-body"]',
    );
    expect(bodyField).not.toBeNull();
    expect(bodyField?.value).toBe("Procedure body");

    cleanupTestRoot(testRoot);
  });

  it("shows episode summary in the detail view", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();
    const item = sampleEpisode("123e4567-e89b-12d3-a456-426614174228", "Episode summary");

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

    const summaryField = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="memory-edit-summary"]',
    );
    expect(summaryField).not.toBeNull();
    expect(summaryField?.value).toBe("Episode summary");

    cleanupTestRoot(testRoot);
  });

  it("shows fact key/value in the detail view", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();
    const item = sampleFact("123e4567-e89b-12d3-a456-426614174229", "user.name", { value: "Ada" });

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

    const keyField = testRoot.container.querySelector<HTMLDivElement>(
      '[data-testid="memory-detail-fact-key"]',
    );
    expect(keyField).not.toBeNull();
    expect(keyField?.textContent).toContain("user.name");

    const valueField = testRoot.container.querySelector<HTMLPreElement>(
      '[data-testid="memory-detail-fact-value"]',
    );
    expect(valueField).not.toBeNull();
    expect(valueField?.textContent).toContain('"Ada"');

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

  it("forgets the originally selected item even if selection changes while dialog is open", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();
    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174500", "First");
    const itemB = sampleNote("123e4567-e89b-12d3-a456-426614174501", "Second");

    ws.memoryList = vi.fn(
      async () => ({ v: 1, items: [itemA, itemB], next_cursor: undefined }) as unknown,
    );
    ws.memoryGet = vi.fn(async (payload) => {
      const memoryItemId = (payload as { memory_item_id?: string }).memory_item_id;
      const item = memoryItemId === itemB.memory_item_id ? itemB : itemA;
      return { v: 1, item } as unknown;
    });
    ws.memoryForget = vi.fn(async (payload) => {
      const memoryItemId = (payload as { selectors?: Array<{ memory_item_id?: string }> })
        .selectors?.[0]?.memory_item_id;
      return {
        v: 1,
        deleted_count: 1,
        tombstones: [
          {
            v: 1,
            memory_item_id: memoryItemId ?? itemA.memory_item_id,
            agent_id: itemA.agent_id,
            deleted_at: "2026-02-19T12:00:02Z",
            deleted_by: "operator",
            reason: "test",
          },
        ],
      } as unknown;
    });

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const testRoot = renderIntoDocument(React.createElement(MemoryInspector, { core }));
    await act(async () => {});

    const itemAButton = testRoot.container.querySelector<HTMLButtonElement>(
      `[data-testid="memory-item-${itemA.memory_item_id}"]`,
    );
    expect(itemAButton).not.toBeNull();

    await act(async () => {
      itemAButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const forgetButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-forget"]',
    );
    expect(forgetButton).not.toBeNull();

    await act(async () => {
      forgetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const itemBButton = testRoot.container.querySelector<HTMLButtonElement>(
      `[data-testid="memory-item-${itemB.memory_item_id}"]`,
    );
    expect(itemBButton).not.toBeNull();

    await act(async () => {
      itemBButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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
      selectors: [{ kind: "id", memory_item_id: itemA.memory_item_id }],
    });

    cleanupTestRoot(testRoot);
  });

  it("shows the forget target and allows canceling", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174502", "Cancel me");

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

    const forgetButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-forget"]',
    );
    expect(forgetButton).not.toBeNull();

    await act(async () => {
      forgetButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = testRoot.container.querySelector<HTMLDivElement>(
      '[data-testid="memory-forget-dialog"]',
    );
    expect(dialog).not.toBeNull();

    const target = testRoot.container.querySelector<HTMLDivElement>(
      '[data-testid="memory-forget-target"]',
    );
    expect(target).not.toBeNull();
    expect(target?.textContent).toContain(item.memory_item_id);

    const cancelButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="memory-forget-cancel"]',
    );
    expect(cancelButton).not.toBeNull();

    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(testRoot.container.querySelector('[data-testid="memory-forget-dialog"]')).toBeNull();
    expect(ws.memoryForget).not.toHaveBeenCalled();

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

  it("downloads exported memory in desktop mode via desktop httpFetch", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
    ws.memoryExport = vi.fn(async () => ({ v: 1, artifact_id: "artifact-999" }) as unknown);

    const httpFetch = vi.fn(async () => ({
      status: 200,
      headers: {
        "content-type": "application/json",
        "content-disposition": 'attachment; filename="tyrum-memory-export-artifact-999.json"',
      },
      bodyText: "{}",
    }));
    const getOperatorConnection = vi.fn(async () => ({
      mode: "embedded",
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test/",
      token: "desktop-token",
      tlsCertFingerprint256: "",
    }));

    const previousDesktop = (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {
      gateway: { httpFetch, getOperatorConnection },
    } as unknown;

    const createObjectUrl = vi.fn(() => "blob:memory-export");
    const revokeObjectUrl = vi.fn();
    const previousCreateObjectUrl = URL.createObjectURL;
    const previousRevokeObjectUrl = URL.revokeObjectURL;
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = createObjectUrl as unknown;
    (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = revokeObjectUrl as unknown;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    try {
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

      const downloadButton = testRoot.container.querySelector<HTMLElement>(
        '[data-testid="memory-export-download"]',
      );
      expect(downloadButton).not.toBeNull();
      expect(downloadButton?.tagName.toLowerCase()).toBe("button");

      await act(async () => {
        downloadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      expect(httpFetch).toHaveBeenCalledWith({
        url: "http://example.test/memory/exports/artifact-999",
        init: {
          method: "GET",
          headers: { authorization: "Bearer desktop-token" },
        },
      });
      expect(createObjectUrl).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();

      cleanupTestRoot(testRoot);
    } finally {
      clickSpy.mockRestore();
      (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = previousDesktop;
      (URL as unknown as { createObjectURL?: unknown }).createObjectURL = previousCreateObjectUrl;
      (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL = previousRevokeObjectUrl;
    }
  });

  it("shows memory export errors", async () => {
    const ws = new FakeWsClient();
    const http = createFakeHttpClient();

    ws.memoryList = vi.fn(async () => ({ v: 1, items: [], next_cursor: undefined }) as unknown);
    ws.memoryExport = vi.fn(async () => {
      throw new Error("export failed");
    });

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

    const error = testRoot.container.querySelector<HTMLDivElement>(
      '[data-testid="memory-export-error"]',
    );
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain("export failed");

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
