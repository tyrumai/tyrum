import { expect, it, vi } from "vitest";
import {
  FakeWsClient,
  expectElement,
  mountMemoryInspector,
  sampleEpisode,
  sampleFact,
  sampleNote,
  sampleProcedure,
  selectMemoryItem,
} from "./memory-inspector.test-helpers.js";

export function registerMemoryInspectorBrowseAndDetailTests(): void {
  it("lists memory items on mount", async () => {
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174222", "Hello");
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    expect(ws.memoryList).toHaveBeenCalled();
    const snippet = expectElement<HTMLDivElement>(
      testRoot.container,
      `[data-testid="memory-item-snippet-${item.memory_item_id}"]`,
    );
    expect(snippet.textContent).toContain("Hello");

    const provenance = expectElement<HTMLDivElement>(
      testRoot.container,
      `[data-testid="memory-item-provenance-${item.memory_item_id}"]`,
    );
    expect(provenance.textContent).toContain("operator");

    cleanup();
  });

  it("scopes browse and inspect requests to the selected agent", async () => {
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174260", "Scoped body", "agent-2");
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);

    const { cleanup, testRoot } = await mountMemoryInspector({ agentId: "agent-2", ws });

    expect(ws.memoryList).toHaveBeenCalledWith({
      v: 1,
      agent_id: "agent-2",
      filter: undefined,
      limit: 50,
      cursor: undefined,
    });

    await selectMemoryItem(testRoot.container, item.memory_item_id);

    expect(ws.memoryGet).toHaveBeenCalledWith({
      v: 1,
      agent_id: "agent-2",
      memory_item_id: item.memory_item_id,
    });

    cleanup();
  });

  it("inspects a memory item when selected", async () => {
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174223", "Inspect body");
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, item.memory_item_id);

    expect(ws.memoryGet).toHaveBeenCalledWith({ v: 1, memory_item_id: item.memory_item_id });
    expect(testRoot.container.textContent).toContain("Inspect body");

    cleanup();
  });

  it("shows procedure body in the detail view", async () => {
    const item = sampleProcedure("123e4567-e89b-12d3-a456-426614174227", "Procedure body");
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, item.memory_item_id);

    const bodyField = expectElement<HTMLTextAreaElement>(
      testRoot.container,
      '[data-testid="memory-edit-body"]',
    );
    expect(bodyField.value).toBe("Procedure body");

    cleanup();
  });

  it("shows episode summary in the detail view", async () => {
    const item = sampleEpisode("123e4567-e89b-12d3-a456-426614174228", "Episode summary");
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, item.memory_item_id);

    const summaryField = expectElement<HTMLTextAreaElement>(
      testRoot.container,
      '[data-testid="memory-edit-summary"]',
    );
    expect(summaryField.value).toBe("Episode summary");

    cleanup();
  });

  it("shows fact key/value in the detail view", async () => {
    const item = sampleFact("123e4567-e89b-12d3-a456-426614174229", "user.name", {
      value: "Ada",
    });
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, item.memory_item_id);

    const keyField = expectElement<HTMLDivElement>(
      testRoot.container,
      '[data-testid="memory-detail-fact-key"]',
    );
    expect(keyField.textContent).toContain("user.name");

    const valueField = expectElement<HTMLPreElement>(
      testRoot.container,
      '[data-testid="memory-detail-fact-value"]',
    );
    expect(valueField.textContent).toContain('"Ada"');

    cleanup();
  });
}
