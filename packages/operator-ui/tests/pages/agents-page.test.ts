// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";
import { createCore, flush } from "./agents-page.test-support.js";

describe("AgentsPage", () => {
  it("loads managed agents, shows names in display surfaces, and refreshes when mobile selection changes", async () => {
    const list = vi.fn(async () => ({
      agents: [
        {
          agent_key: "default",
          agent_id: "11111111-1111-4111-8111-111111111111",
          can_delete: false,
          is_primary: true,
          persona: { name: "Feynman" },
        },
        {
          agent_key: "agent-1",
          agent_id: "22222222-2222-4222-8222-222222222222",
          can_delete: true,
          is_primary: false,
          persona: { name: "Ada" },
        },
      ],
    }));
    const { core, setAgentKey, refresh } = createCore({ list });

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    expect(list).toHaveBeenCalledTimes(1);
    expect(setAgentKey).toHaveBeenCalledWith("default");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(testRoot.container.querySelector('[data-testid="agents-tab-editor"]')).not.toBeNull();
    expect(
      testRoot.container.querySelector(
        '[data-testid="agents-list-panel"] [data-testid="agents-refresh"]',
      ),
    ).not.toBeNull();
    expect(
      testRoot.container.querySelector(
        '[data-testid="agents-list-panel"] [data-testid="agents-new"]',
      ),
    ).not.toBeNull();

    const agentButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-select-agent-1"]',
    );
    expect(agentButton).not.toBeNull();
    expect(agentButton?.textContent).toContain("Ada");
    expect(agentButton?.textContent).not.toContain("agent-1");

    const selectedName = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="agents-selected-name"]',
    );
    expect(selectedName?.textContent).toContain("Feynman");

    const mobileSelect = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-select"]',
    );
    expect(mobileSelect?.textContent).toContain("Feynman");
    expect(mobileSelect?.textContent).not.toContain("default");

    await act(async () => {
      if (mobileSelect) click(mobileSelect);
      await Promise.resolve();
    });

    const mobileOption = document.querySelector<HTMLElement>(
      '[data-testid="agents-mobile-select-agent-1"]',
    );
    expect(mobileOption?.textContent).toContain("Ada");
    expect(mobileOption?.textContent).not.toContain("agent-1");

    await act(async () => {
      if (mobileOption) click(mobileOption);
      await Promise.resolve();
    });

    expect(setAgentKey).toHaveBeenLastCalledWith("agent-1");
    expect(refresh).toHaveBeenCalledTimes(2);

    cleanupTestRoot(testRoot);
  });

  it("uses avatars to distinguish duplicate names without rendering raw keys", async () => {
    const list = vi.fn(async () => ({
      agents: [
        {
          agent_key: "default",
          agent_id: "11111111-1111-4111-8111-111111111111",
          can_delete: false,
          is_primary: true,
          persona: { name: "Ada" },
        },
        {
          agent_key: "agent-1",
          agent_id: "22222222-2222-4222-8222-222222222222",
          can_delete: true,
          is_primary: false,
          persona: { name: "Ada" },
        },
      ],
    }));
    const { core } = createCore({ list });

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    const listPanel = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="agents-list-panel"]',
    );
    const firstAgentButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-select-default"]',
    );
    const secondAgentButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-select-agent-1"]',
    );
    const firstAvatar = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="agents-avatar-default"]',
    );
    const secondAvatar = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="agents-avatar-agent-1"]',
    );

    expect(listPanel?.className).toContain("w-[clamp(220px,24vw,300px)]");
    expect(firstAgentButton?.textContent).toContain("Ada");
    expect(firstAgentButton?.textContent).not.toContain("default");
    expect(secondAgentButton?.textContent).toContain("Ada");
    expect(secondAgentButton?.textContent).not.toContain("agent-1");
    expect(firstAvatar?.getAttribute("data-avatar-variant")).toBe(
      secondAvatar?.getAttribute("data-avatar-variant"),
    );
    expect(firstAvatar?.getAttribute("data-avatar-pattern")).not.toBe(
      secondAvatar?.getAttribute("data-avatar-pattern"),
    );

    await act(async () => {
      secondAgentButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const selectedName = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="agents-selected-name"]',
    );
    expect(selectedName?.textContent).toBe("Ada");
    expect(testRoot.container.querySelector('[data-testid="agents-selected-key"]')).toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("prefers the primary agent when restoring selection", async () => {
    const list = vi.fn(async () => ({
      agents: [
        {
          agent_key: "default",
          agent_id: "11111111-1111-4111-8111-111111111111",
          can_delete: true,
          is_primary: false,
          persona: { name: "Fallback" },
        },
        {
          agent_key: "agent-1",
          agent_id: "22222222-2222-4222-8222-222222222222",
          can_delete: false,
          is_primary: true,
          persona: { name: "Primary Agent" },
        },
      ],
    }));
    const { core, setAgentKey, refresh } = createCore({ list });

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    expect(setAgentKey).toHaveBeenCalledWith("agent-1");
    expect(refresh).toHaveBeenCalledTimes(1);

    const selectedName = testRoot.container.querySelector<HTMLElement>(
      '[data-testid="agents-selected-name"]',
    );
    expect(selectedName?.textContent).toContain("Primary Agent");

    cleanupTestRoot(testRoot);
  });
});
