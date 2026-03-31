// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React from "react";
import { WorkBoardPage } from "../../src/components/pages/workboard-page.js";
import { cleanupTestRoot, renderIntoDocument, stubMatchMedia } from "../test-utils.js";
import { createCore, flushEffects } from "./workboard-page.test-support.js";

describe("WorkBoardPage scope controls", () => {
  it("shows the resolved active agent name for an implicit blank scope", async () => {
    const { core, http } = createCore("connected", undefined, {
      scopeKeys: { agent_key: "", workspace_key: "" },
      resolvedScope: {
        tenant_id: "tenant-default",
        agent_id: "agent-default",
        workspace_id: "workspace-default",
      },
      supported: true,
    });
    http.agents.list.mockResolvedValueOnce({
      agents: [
        { agent_key: "builder", agent_id: "agent-builder", persona: { name: "Builder" } },
        {
          agent_key: "default",
          agent_id: " agent-default ",
          persona: { name: "Default Agent" },
        },
      ],
    });

    const matchMedia = stubMatchMedia("(min-width: 1160px)", true);
    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();

      const agentSelect = testRoot.container.querySelector<HTMLSelectElement>(
        '[data-testid="workboard-scope-agent"]',
      );
      expect(agentSelect).not.toBeNull();
      expect(agentSelect?.value).toBe("");
      expect(agentSelect?.selectedOptions[0]?.text).toBe("Primary agent: Default Agent");
      expect(Array.from(agentSelect?.options ?? []).map((option) => option.text)).toEqual([
        "Primary agent: Default Agent",
        "Builder",
        "Default Agent",
      ]);
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });

  it("falls back to a generic label for an unresolved implicit scope", async () => {
    const { core, http } = createCore("connected", undefined, {
      scopeKeys: { agent_key: "", workspace_key: "" },
      resolvedScope: null,
      supported: true,
    });
    http.agents.list.mockResolvedValueOnce({
      agents: [{ agent_key: "builder", persona: { name: "Builder" } }],
    });

    const matchMedia = stubMatchMedia("(min-width: 1160px)", true);
    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();

      const agentSelect = testRoot.container.querySelector<HTMLSelectElement>(
        '[data-testid="workboard-scope-agent"]',
      );
      expect(agentSelect).not.toBeNull();
      expect(agentSelect?.value).toBe("");
      expect(agentSelect?.selectedOptions[0]?.text).toBe("Primary agent");
      expect(Array.from(agentSelect?.options ?? []).map((option) => option.text)).toEqual([
        "Primary agent",
        "Builder",
      ]);
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });

  it("uses the primary agent metadata when resolved scope is unavailable", async () => {
    const { core, http } = createCore("connected", undefined, {
      scopeKeys: { agent_key: "", workspace_key: "" },
      resolvedScope: null,
      supported: true,
    });
    http.agents.list.mockResolvedValueOnce({
      agents: [
        { agent_key: "builder", persona: { name: "Builder" } },
        { agent_key: "default", is_primary: true, persona: { name: "Default Agent" } },
      ],
    });

    const matchMedia = stubMatchMedia("(min-width: 1160px)", true);
    const testRoot = renderIntoDocument(React.createElement(WorkBoardPage, { core }));
    try {
      await flushEffects();

      const agentSelect = testRoot.container.querySelector<HTMLSelectElement>(
        '[data-testid="workboard-scope-agent"]',
      );
      expect(agentSelect).not.toBeNull();
      expect(agentSelect?.value).toBe("");
      expect(agentSelect?.selectedOptions[0]?.text).toBe("Primary agent: Default Agent");
    } finally {
      matchMedia.cleanup();
      cleanupTestRoot(testRoot);
    }
  });
});
