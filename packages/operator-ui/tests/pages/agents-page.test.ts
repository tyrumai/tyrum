// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

describe("AgentsPage", () => {
  it("trims agent_id before fetching status and supports empty agent_id", async () => {
    const agentStatusGet = vi.fn().mockResolvedValue({ ok: true });
    const core = { http: { agentStatus: { get: agentStatusGet } } } as unknown as OperatorCore;

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

    expect(agentStatusGet).toHaveBeenCalledTimes(1);
    expect(agentStatusGet).toHaveBeenCalledWith({ agent_id: "agent-1" });

    const refreshButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-refresh"]',
    );
    expect(refreshButton).not.toBeNull();

    await act(async () => {
      refreshButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(agentStatusGet).toHaveBeenCalledTimes(2);

    act(() => {
      setNativeValue(agentIdInput as HTMLInputElement, "   ");
    });

    await act(async () => {
      fetchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(agentStatusGet).toHaveBeenCalledTimes(3);
    expect(agentStatusGet).toHaveBeenLastCalledWith(undefined);

    cleanupTestRoot(testRoot);
  });
});
