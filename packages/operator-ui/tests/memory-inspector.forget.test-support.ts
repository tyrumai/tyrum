import { expect, it, vi } from "vitest";
import {
  FakeWsClient,
  clickElement,
  emitWsEvent,
  expectElement,
  flushMemoryInspector,
  mountMemoryInspector,
  sampleNote,
  sampleTombstone,
  selectMemoryItem,
  setFieldValue,
} from "./memory-inspector.test-helpers.js";

export function registerMemoryInspectorForgetTests(): void {
  it("forgets a memory item with explicit confirmation and shows tombstone", async () => {
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174225", "Forget me");
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);
    ws.memoryForget = vi.fn(async () => ({
      v: 1,
      deleted_count: 1,
      tombstones: [sampleTombstone(item)],
    }));

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, item.memory_item_id);

    const forgetButton = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-forget"]',
    );
    await clickElement(forgetButton);

    const confirmField = expectElement<HTMLInputElement>(
      document,
      '[data-testid="memory-forget-confirm"]',
    );
    await setFieldValue(confirmField, "FORGET");

    const confirmButton = expectElement<HTMLButtonElement>(
      document,
      '[data-testid="memory-forget-submit"]',
    );
    await clickElement(confirmButton);

    expect(ws.memoryForget).toHaveBeenCalledWith({
      v: 1,
      confirm: "FORGET",
      selectors: [{ kind: "id", memory_item_id: item.memory_item_id }],
    });
    expect(testRoot.container.textContent).toContain("tombstone");
    expect(testRoot.container.textContent).toContain(item.memory_item_id);

    cleanup();
  });

  it("forgets the originally selected item even if selection changes while dialog is open", async () => {
    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174500", "First");
    const itemB = sampleNote("123e4567-e89b-12d3-a456-426614174501", "Second");
    const ws = new FakeWsClient();
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
          sampleTombstone(itemA, { memory_item_id: memoryItemId ?? itemA.memory_item_id }),
        ],
      } as unknown;
    });

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, itemA.memory_item_id);

    const forgetButton = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-forget"]',
    );
    await clickElement(forgetButton);
    await selectMemoryItem(testRoot.container, itemB.memory_item_id);

    const confirmField = expectElement<HTMLInputElement>(
      document,
      '[data-testid="memory-forget-confirm"]',
    );
    await setFieldValue(confirmField, "FORGET");

    const confirmButton = expectElement<HTMLButtonElement>(
      document,
      '[data-testid="memory-forget-submit"]',
    );
    await clickElement(confirmButton);

    expect(ws.memoryForget).toHaveBeenCalledWith({
      v: 1,
      confirm: "FORGET",
      selectors: [{ kind: "id", memory_item_id: itemA.memory_item_id }],
    });

    cleanup();
  });

  it("shows the forget target and allows canceling", async () => {
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174502", "Cancel me");
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, item.memory_item_id);

    const forgetButton = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-forget"]',
    );
    await clickElement(forgetButton);

    expectElement<HTMLDivElement>(document, '[data-testid="memory-forget-dialog"]');

    const target = expectElement<HTMLElement>(document, '[data-testid="memory-forget-target"]');
    expect(target.textContent).toContain(item.memory_item_id);

    const cancelButton = expectElement<HTMLButtonElement>(
      document,
      '[data-testid="memory-forget-cancel"]',
    );
    await clickElement(cancelButton);

    expect(document.querySelector('[data-testid="memory-forget-dialog"]')).toBeNull();
    expect(ws.memoryForget).not.toHaveBeenCalled();

    cleanup();
  });

  it("clears forget dialog state when inspected item is forgotten externally", async () => {
    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174503", "First");
    const itemB = sampleNote("123e4567-e89b-12d3-a456-426614174504", "Second");
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(
      async () => ({ v: 1, items: [itemA, itemB], next_cursor: undefined }) as unknown,
    );
    ws.memoryGet = vi.fn(async (payload) => {
      const memoryItemId = (payload as { memory_item_id?: string }).memory_item_id;
      const item = memoryItemId === itemB.memory_item_id ? itemB : itemA;
      return { v: 1, item } as unknown;
    });

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, itemA.memory_item_id);

    const forgetButton = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-forget"]',
    );
    await clickElement(forgetButton);

    expect(document.querySelector('[data-testid="memory-forget-dialog"]')).not.toBeNull();

    await emitWsEvent(ws, "memory.item.forgotten", {
      payload: {
        tombstone: sampleTombstone(itemA, { reason: "external" }),
      },
    });
    await flushMemoryInspector();

    await selectMemoryItem(testRoot.container, itemB.memory_item_id);
    await flushMemoryInspector();

    expect(document.querySelector('[data-testid="memory-forget-dialog"]')).toBeNull();

    cleanup();
  });
}
