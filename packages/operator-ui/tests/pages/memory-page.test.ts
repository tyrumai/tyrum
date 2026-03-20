// @vitest-environment jsdom

import type { MemoryItem } from "@tyrum/contracts";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-app/src/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPage } from "../../src/components/pages/memory-page.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

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

let adminHttpClient: MockAdminHttpClient | null = null;
const requestEnter = vi.fn();

vi.mock("../../src/components/pages/admin-http-shared.js", async () => {
  const actual = await import("../../src/components/pages/admin-http-shared.js");

  return {
    ...actual,
    useAdminHttpClient: () => adminHttpClient as unknown as OperatorCore["admin"],
    useAdminMutationHttpClient: () => null,
    useAdminMutationAccess: () => ({
      canMutate: false,
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
  requestEnter.mockReset();
});

afterEach(() => {
  adminHttpClient = null;
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
});
