// @vitest-environment jsdom

import { AgentConfig } from "@tyrum/contracts";
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentsPageEditor } from "../../src/components/pages/agents-page-editor.js";
import { createCore, flush, sampleManagedAgentDetail } from "./agents-page-editor.test-helpers.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";

describe("AgentsPageEditor canonical tool exposure", () => {
  it("renders persisted canonical tool exposure in edit mode and preserves read-model selectors on save", async () => {
    const existingDetail = {
      ...sampleManagedAgentDetail("default"),
      config: AgentConfig.parse({
        ...sampleManagedAgentDetail("default").config,
        tools: {
          bundle: "legacy-config-bundle",
          tier: "default",
          default_mode: "deny",
          allow: ["read"],
          deny: ["bash"],
        },
      }),
      tool_exposure: {
        ...sampleManagedAgentDetail("default").tool_exposure,
        tools: {
          bundle: "authoring-core",
          tier: "advanced" as const,
        },
      },
    };
    const get = vi.fn().mockResolvedValue(existingDetail);
    const capabilities = vi.fn(async () => ({
      skills: { default_mode: "allow", allow: [], deny: [], workspace_trusted: true, items: [] },
      mcp: {
        default_mode: "allow",
        allow: [],
        deny: [],
        items: [
          {
            id: "memory",
            name: "Memory",
            transport: "stdio" as const,
            source: "builtin" as const,
          },
        ],
      },
      tools: {
        bundle: "capabilities-only",
        tier: "default" as const,
        default_mode: "allow",
        allow: [],
        deny: [],
        items: [
          {
            id: "read",
            description: "Read files",
            source: "builtin" as const,
            family: null,
            backing_server_id: null,
          },
        ],
      },
    }));
    const update = vi.fn().mockResolvedValue(existingDetail);
    const core = createCore(vi.fn(), get, capabilities, update);

    const testRoot = renderIntoDocument(
      React.createElement(AgentsPageEditor, {
        core,
        mode: "edit",
        createNonce: 1,
        agentKey: "default",
        onSaved: vi.fn(),
        onCancelCreate: vi.fn(),
      }),
    );
    await flush();

    expect(testRoot.container.textContent).toContain("Persisted canonical exposure");
    expect(
      testRoot.container.querySelector('[data-testid="agents-editor-tools-canonical-bundle"]')
        ?.textContent,
    ).toBe("authoring-core");
    expect(
      testRoot.container.querySelector('[data-testid="agents-editor-tools-canonical-tier"]')
        ?.textContent,
    ).toBe("Advanced");

    const saveButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="agents-editor-save"]',
    );
    expect(saveButton).not.toBeNull();

    await act(async () => {
      if (saveButton) click(saveButton);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        config: expect.objectContaining({
          tools: expect.objectContaining({
            bundle: "authoring-core",
            tier: "advanced",
            default_mode: "deny",
            allow: ["read"],
            deny: ["bash"],
          }),
        }),
      }),
    );
    expect(update).not.toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        config: expect.objectContaining({
          tools: expect.objectContaining({
            bundle: "legacy-config-bundle",
            tier: "default",
          }),
        }),
      }),
    );

    cleanupTestRoot(testRoot);
  });
});
