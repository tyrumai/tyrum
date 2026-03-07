import type { MemoryItem } from "@tyrum/client";
import { expect, it, vi } from "vitest";
import {
  FakeWsClient,
  clickElement,
  emitWsEvent,
  expectElement,
  flushMemoryInspector,
  mountMemoryInspector,
  sampleNote,
  setFieldValue,
  selectMemoryItem,
} from "./memory-inspector.test-helpers.js";

export function registerMemoryInspectorEditingTests(): void {
  it("updates a memory item body", async () => {
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174224", "Before");
    const updated: MemoryItem = { ...item, body_md: "After", updated_at: "2026-02-19T12:00:01Z" };
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);
    ws.memoryUpdate = vi.fn(async () => ({ v: 1, item: updated }) as unknown);

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, item.memory_item_id);

    const bodyField = expectElement<HTMLTextAreaElement>(
      testRoot.container,
      '[data-testid="memory-edit-body"]',
    );
    await setFieldValue(bodyField, "After");

    const saveButton = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-save"]',
    );
    await clickElement(saveButton);

    expect(ws.memoryUpdate).toHaveBeenCalledWith({
      v: 1,
      memory_item_id: item.memory_item_id,
      patch: { body_md: "After" },
    });
    const updatedBodyField = expectElement<HTMLTextAreaElement>(
      testRoot.container,
      '[data-testid="memory-edit-body"]',
    );
    expect(updatedBodyField.value).toBe("After");

    cleanup();
  });

  it("disables body edits while a save is in-flight", async () => {
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174233", "Before");
    const updated: MemoryItem = { ...item, body_md: "After", updated_at: "2026-02-19T12:00:01Z" };
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);

    let resolveUpdate: ((value: unknown) => void) | undefined;
    ws.memoryUpdate = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }) as unknown,
    );

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, item.memory_item_id);

    const bodyField = expectElement<HTMLTextAreaElement>(
      testRoot.container,
      '[data-testid="memory-edit-body"]',
    );
    await setFieldValue(bodyField, "After");

    const saveButton = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-save"]',
    );
    await clickElement(saveButton);

    const disabledBodyField = expectElement<HTMLTextAreaElement>(
      testRoot.container,
      '[data-testid="memory-edit-body"]',
    );
    expect(disabledBodyField.disabled).toBe(true);

    resolveUpdate?.({ v: 1, item: updated } as unknown);
    await flushMemoryInspector();

    cleanup();
  });

  it("preserves draft body edits when the inspected item is upserted externally", async () => {
    const item = sampleNote("123e4567-e89b-12d3-a456-426614174234", "Before");
    const upserted: MemoryItem = {
      ...item,
      body_md: "Server update",
      updated_at: "2026-02-19T12:00:01Z",
    };
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, item.memory_item_id);

    const bodyField = expectElement<HTMLTextAreaElement>(
      testRoot.container,
      '[data-testid="memory-edit-body"]',
    );
    await setFieldValue(bodyField, "User draft");

    await emitWsEvent(ws, "memory.item.updated", { payload: { item: upserted } });
    await flushMemoryInspector();

    const updatedBodyField = expectElement<HTMLTextAreaElement>(
      testRoot.container,
      '[data-testid="memory-edit-body"]',
    );
    expect(updatedBodyField.value).toBe("User draft");

    cleanup();
  });

  it("updates tags when stored item contains duplicate tags", async () => {
    const item = {
      ...sampleNote("123e4567-e89b-12d3-a456-426614174230", "Body"),
      tags: ["x", "x"],
    };
    const updated: MemoryItem = { ...item, tags: ["x", "y"], updated_at: "2026-02-19T12:00:01Z" };
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(async () => ({ v: 1, items: [item], next_cursor: undefined }) as unknown);
    ws.memoryGet = vi.fn(async () => ({ v: 1, item }) as unknown);
    ws.memoryUpdate = vi.fn(async () => ({ v: 1, item: updated }) as unknown);

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, item.memory_item_id);

    const tagsField = expectElement<HTMLInputElement>(
      testRoot.container,
      '[data-testid="memory-edit-tags"]',
    );
    await setFieldValue(tagsField, "x, y");

    const saveButton = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-save"]',
    );
    await clickElement(saveButton);

    expect(ws.memoryUpdate).toHaveBeenCalledWith({
      v: 1,
      memory_item_id: item.memory_item_id,
      patch: { tags: ["x", "y"] },
    });

    cleanup();
  });

  it("clears save errors when switching inspected items", async () => {
    const itemA = sampleNote("123e4567-e89b-12d3-a456-426614174231", "First body");
    const itemB = sampleNote("123e4567-e89b-12d3-a456-426614174232", "Second body");
    const ws = new FakeWsClient();
    ws.memoryList = vi.fn(
      async () => ({ v: 1, items: [itemA, itemB], next_cursor: undefined }) as unknown,
    );
    ws.memoryGet = vi.fn(async (payload) => {
      const memoryItemId = (payload as { memory_item_id?: string }).memory_item_id;
      const item = memoryItemId === itemB.memory_item_id ? itemB : itemA;
      return { v: 1, item } as unknown;
    });
    ws.memoryUpdate = vi.fn(async () => {
      throw new Error("save failed");
    });

    const { cleanup, testRoot } = await mountMemoryInspector({ ws });

    await selectMemoryItem(testRoot.container, itemA.memory_item_id);

    const bodyField = expectElement<HTMLTextAreaElement>(
      testRoot.container,
      '[data-testid="memory-edit-body"]',
    );
    await setFieldValue(bodyField, "Changed body");

    const saveButton = expectElement<HTMLButtonElement>(
      testRoot.container,
      '[data-testid="memory-save"]',
    );
    await clickElement(saveButton);
    await flushMemoryInspector();

    const saveError = expectElement<HTMLDivElement>(
      testRoot.container,
      '[data-testid="memory-save-error"]',
    );
    expect(saveError.textContent).toContain("save failed");

    await selectMemoryItem(testRoot.container, itemB.memory_item_id);
    await flushMemoryInspector();

    expect(testRoot.container.querySelector('[data-testid="memory-save-error"]')).toBeNull();

    cleanup();
  });
}
