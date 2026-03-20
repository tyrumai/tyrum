// @vitest-environment jsdom

import type { MemoryItem, MemoryTombstone } from "@tyrum/contracts";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPage } from "../../src/components/pages/memory-page.js";
import { cleanupTestRoot, click, renderIntoDocument, setNativeValue } from "../test-utils.js";

type MockAdminHttpClient = {
  agentList: {
    get: ReturnType<typeof vi.fn>;
  };
  memory: {
    list: ReturnType<typeof vi.fn>;
    listTombstones: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
  };
};

type MockMutationHttpClient = {
  memory: {
    delete: ReturnType<typeof vi.fn>;
  };
};

let adminHttpClient: MockAdminHttpClient | null = null;
let mutationHttpClient: MockMutationHttpClient | null = null;
let canMutate = false;
const requestEnter = vi.fn();

vi.mock("../../src/components/pages/admin-http-shared.js", async () => {
  const actual = await import("../../src/components/pages/admin-http-shared.js");

  return {
    ...actual,
    useAdminHttpClient: () => adminHttpClient as unknown as OperatorCore["admin"],
    useAdminMutationHttpClient: () => mutationHttpClient as unknown as OperatorCore["admin"],
    useAdminMutationAccess: () => ({
      canMutate,
      requestEnter,
    }),
  };
});

function createNoteItem(memoryItemId: string, title: string): MemoryItem {
  return {
    v: 1,
    memory_item_id: memoryItemId,
    agent_id: "00000000-0000-4000-8000-000000000002",
    kind: "note",
    title,
    body_md: `${title} body`,
    tags: [],
    sensitivity: "private",
    provenance: { source_kind: "tool", refs: [] },
    created_at: "2026-03-20T10:00:00.000Z",
  };
}

function createTombstone(item: MemoryItem): MemoryTombstone {
  return {
    v: 1,
    memory_item_id: item.memory_item_id,
    agent_id: item.agent_id,
    deleted_at: "2026-03-20T10:05:00.000Z",
    deleted_by: "operator",
    reason: "Operator deletion via UI",
  };
}

function createAdminHttpClient() {
  const successfulTitle = "Operational note";
  const successfulItem = createNoteItem("550e8400-e29b-41d4-a716-446655440000", successfulTitle);
  const failedItemId = "550e8400-e29b-41d4-a716-446655440001";
  const getById = vi.fn(async (memoryItemId: string) => {
    if (memoryItemId === successfulItem.memory_item_id) {
      return { item: successfulItem };
    }
    throw new Error("lookup failed");
  });

  return {
    successfulTitle,
    failedItemId,
    getById,
    client: {
      agentList: {
        get: vi.fn(async () => ({ agents: [] })),
      },
      memory: {
        list: vi.fn(async () => ({ items: [] })),
        listTombstones: vi.fn(async () => ({ tombstones: [] })),
        search: vi.fn(async () => ({
          v: 1 as const,
          hits: [
            { memory_item_id: successfulItem.memory_item_id, kind: "note" as const, score: 0.9 },
            { memory_item_id: failedItemId, kind: "note" as const, score: 0.5 },
          ],
        })),
        getById,
      },
    } satisfies MockAdminHttpClient,
  };
}

function getTabTrigger(container: ParentNode, labelPrefix: string): HTMLButtonElement {
  const trigger = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (element) => element.textContent?.startsWith(labelPrefix),
  );
  expect(trigger).toBeDefined();
  return trigger!;
}

function getActiveTabPanel(container: ParentNode): HTMLElement {
  const panel = container.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]');
  expect(panel).not.toBeNull();
  return panel!;
}

function getLoadMoreButton(root: ParentNode): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((element) =>
    element.textContent?.includes("Load more"),
  );
  expect(button).toBeDefined();
  return button!;
}

async function flushPage(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForAssertion(assertion: () => void, attempts = 10): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushPage();
    }
  }

  throw lastError;
}

beforeEach(() => {
  adminHttpClient = null;
  mutationHttpClient = null;
  canMutate = false;
  requestEnter.mockReset();
});

afterEach(() => {
  adminHttpClient = null;
  mutationHttpClient = null;
  canMutate = false;
  requestEnter.mockReset();
  vi.useRealTimers();
});

describe("MemoryPage", () => {
  it("does not refetch failed search hits after a mixed search result batch", async () => {
    vi.useFakeTimers();
    const { client, failedItemId, getById, successfulTitle } = createAdminHttpClient();
    adminHttpClient = client;

    const testRoot = renderIntoDocument(
      React.createElement(MemoryPage, { core: {} as OperatorCore }),
    );

    try {
      await flushPage();

      const searchInput = testRoot.container.querySelector<HTMLInputElement>(
        'input[placeholder="Search memory…"]',
      );
      expect(searchInput).not.toBeNull();

      act(() => {
        setNativeValue(searchInput as HTMLInputElement, "operational");
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      await waitForAssertion(() => {
        expect(getById).toHaveBeenCalledTimes(2);
      });

      expect(
        getById.mock.calls.filter(([memoryItemId]) => memoryItemId === failedItemId),
      ).toHaveLength(1);

      await flushPage();
      await flushPage();

      expect(getById).toHaveBeenCalledTimes(2);
      expect(testRoot.container.textContent).toContain(successfulTitle);
      expect(testRoot.container.textContent).not.toContain("Loading search results");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("removes deleted search results immediately after a confirmed delete", async () => {
    vi.useFakeTimers();
    const item = createNoteItem("550e8400-e29b-41d4-a716-446655440010", "Search result note");
    const deleteMemoryItem = vi.fn(async () => ({ tombstone: createTombstone(item) }));
    adminHttpClient = {
      agentList: {
        get: vi.fn(async () => ({ agents: [] })),
      },
      memory: {
        list: vi.fn(async () => ({ items: [] })),
        listTombstones: vi.fn(async () => ({ tombstones: [] })),
        search: vi.fn(async () => ({
          v: 1 as const,
          hits: [{ memory_item_id: item.memory_item_id, kind: item.kind, score: 0.9 }],
        })),
        getById: vi.fn(async () => ({ item })),
      },
    };
    mutationHttpClient = {
      memory: {
        delete: deleteMemoryItem,
      },
    };
    canMutate = true;

    const testRoot = renderIntoDocument(
      React.createElement(MemoryPage, { core: {} as OperatorCore }),
    );

    try {
      await flushPage();

      const searchInput = testRoot.container.querySelector<HTMLInputElement>(
        'input[placeholder="Search memory…"]',
      );
      expect(searchInput).not.toBeNull();

      act(() => {
        setNativeValue(searchInput as HTMLInputElement, "search");
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      await waitForAssertion(() => {
        expect(testRoot.container.textContent).toContain(item.title ?? "");
      });

      const deleteButton = testRoot.container.querySelector<HTMLButtonElement>(
        'button[title="Delete memory item"]',
      );
      expect(deleteButton).not.toBeNull();

      await act(async () => {
        click(deleteButton!);
        await Promise.resolve();
      });

      await act(async () => {
        document.body
          .querySelector<HTMLElement>('[data-testid="confirm-danger-checkbox"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
      expect(
        document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-danger-confirm"]')
          ?.disabled,
      ).toBe(false);
      await act(async () => {
        click(
          document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-danger-confirm"]')!,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitForAssertion(() => {
        expect(deleteMemoryItem).toHaveBeenCalledWith(item.memory_item_id, {
          reason: "Operator deletion via UI",
        });
        expect(testRoot.container.textContent).toContain("No matches");
        expect(testRoot.container.textContent).toContain("Deleted (1)");
        expect(testRoot.container.textContent).not.toContain(item.title ?? "");
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("keeps item and tombstone pagination state independent across tabs", async () => {
    const item = createNoteItem("550e8400-e29b-41d4-a716-446655440020", "Paged item");
    const tombstone = createTombstone(item);
    let resolveItemsPage:
      | ((value: { items: MemoryItem[]; next_cursor?: string | undefined }) => void)
      | null = null;

    const list = vi.fn(
      async (params?: {
        agent_id?: string;
        kinds?: MemoryItem["kind"][];
        sensitivities?: MemoryItem["sensitivity"][];
        cursor?: string;
      }) => {
        if (params?.cursor === "items-cursor") {
          return await new Promise<{ items: MemoryItem[]; next_cursor?: string }>((resolve) => {
            resolveItemsPage = resolve;
          });
        }
        return { items: [item], next_cursor: "items-cursor" };
      },
    );
    const listTombstones = vi.fn(async (params?: { agent_id?: string; cursor?: string }) => {
      if (params?.cursor === "tombstones-cursor") {
        return {
          tombstones: [
            tombstone,
            createTombstone(createNoteItem("550e8400-e29b-41d4-a716-446655440021", "Deleted item")),
          ],
        };
      }
      return { tombstones: [tombstone], next_cursor: "tombstones-cursor" };
    });

    adminHttpClient = {
      agentList: {
        get: vi.fn(async () => ({ agents: [] })),
      },
      memory: {
        list,
        listTombstones,
        search: vi.fn(async () => ({ v: 1 as const, hits: [] })),
        getById: vi.fn(async () => {
          throw new Error("not used");
        }),
      },
    };

    const testRoot = renderIntoDocument(
      React.createElement(MemoryPage, { core: {} as OperatorCore }),
    );

    try {
      await flushPage();

      const itemsLoadMoreButton = getLoadMoreButton(getActiveTabPanel(testRoot.container));
      expect(itemsLoadMoreButton.disabled).toBe(false);

      await act(async () => {
        click(itemsLoadMoreButton);
        await Promise.resolve();
      });

      await waitForAssertion(() => {
        expect(list).toHaveBeenCalledWith(
          expect.objectContaining({
            cursor: "items-cursor",
          }),
        );
        expect(getLoadMoreButton(getActiveTabPanel(testRoot.container)).disabled).toBe(true);
      });

      await act(async () => {
        click(getTabTrigger(testRoot.container, "Deleted"));
        await Promise.resolve();
      });

      const tombstonesLoadMoreButton = getLoadMoreButton(getActiveTabPanel(testRoot.container));
      expect(tombstonesLoadMoreButton.disabled).toBe(false);

      await act(async () => {
        click(tombstonesLoadMoreButton);
        await Promise.resolve();
      });

      await waitForAssertion(() => {
        expect(listTombstones).toHaveBeenCalledWith({
          agent_id: undefined,
          cursor: "tombstones-cursor",
        });
      });
    } finally {
      resolveItemsPage?.({ items: [], next_cursor: undefined });
      await flushPage();
      cleanupTestRoot(testRoot);
    }
  });
});
