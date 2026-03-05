// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

describe("AgentsPage", () => {
  it("trims agent_key before fetching status and supports empty agent_key", async () => {
    const setAgentKey = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const snapshot = {
      agentKey: "default",
      status: null,
      loading: false,
      error: null,
      lastSyncedAt: null,
    } as const;
    const core = {
      agentStatusStore: {
        subscribe: (_listener: () => void) => () => {},
        getSnapshot: () => snapshot,
        setAgentKey,
        refresh,
      },
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));

    const agentIdInput = testRoot.container.querySelector<HTMLInputElement>(
      'input[placeholder="default"]',
    );
    expect(agentIdInput).not.toBeNull();

    act(() => {
      setNativeValue(agentIdInput as HTMLInputElement, "  agent-1  ");
    });

    const fetchButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-status-fetch"]',
    );
    expect(fetchButton).not.toBeNull();

    await act(async () => {
      fetchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(setAgentKey).toHaveBeenCalledTimes(1);
    expect(setAgentKey).toHaveBeenCalledWith("agent-1");
    expect(refresh).toHaveBeenCalledTimes(1);

    const refreshButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-refresh"]',
    );
    expect(refreshButton).toBeNull();

    act(() => {
      setNativeValue(agentIdInput as HTMLInputElement, "   ");
    });

    await act(async () => {
      fetchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(setAgentKey).toHaveBeenCalledTimes(2);
    expect(setAgentKey).toHaveBeenLastCalledWith("");
    expect(refresh).toHaveBeenCalledTimes(2);

    cleanupTestRoot(testRoot);
  });
});
