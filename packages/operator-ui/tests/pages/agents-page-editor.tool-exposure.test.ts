// @vitest-environment jsdom

import { AgentConfig } from "@tyrum/contracts";
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentsPageEditor } from "../../src/components/pages/agents-page-editor.js";
import {
  createCore,
  flush,
  sampleManagedAgentDetail,
  setLabeledValue,
} from "./agents-page-editor.test-helpers.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";

describe("AgentsPageEditor canonical tool exposure", () => {
  it("loads canonical tool exposure from the read model, saves edits, and reloads them", async () => {
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
    const savedDetail = {
      ...existingDetail,
      config: AgentConfig.parse({
        ...existingDetail.config,
        tools: {
          ...existingDetail.config.tools,
          bundle: "workspace-default",
          tier: "default",
        },
      }),
      tool_exposure: {
        ...existingDetail.tool_exposure,
        tools: {
          bundle: "workspace-default",
          tier: "default" as const,
        },
      },
    };
    const get = vi.fn().mockResolvedValueOnce(existingDetail).mockResolvedValueOnce(savedDetail);
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
    const update = vi.fn().mockResolvedValue(savedDetail);
    const core = createCore(vi.fn(), get, capabilities, update);

    let testRoot = renderIntoDocument(
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

    expect(
      testRoot.container.querySelector<HTMLSelectElement>(
        '[data-testid="agents-editor-tools-canonical-bundle"]',
      )?.value,
    ).toBe("authoring-core");
    expect(
      testRoot.container.querySelector<HTMLSelectElement>(
        '[data-testid="agents-editor-tools-canonical-tier"]',
      )?.value,
    ).toBe("advanced");

    await act(async () => {
      setLabeledValue(testRoot.container, "Bundle", "workspace-default");
      setLabeledValue(testRoot.container, "Tier", "default");
      await Promise.resolve();
    });

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
            bundle: "workspace-default",
            tier: "default",
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
            tier: "advanced",
          }),
        }),
      }),
    );

    cleanupTestRoot(testRoot);
    testRoot = renderIntoDocument(
      React.createElement(AgentsPageEditor, {
        core,
        mode: "edit",
        createNonce: 2,
        agentKey: "default",
        onSaved: vi.fn(),
        onCancelCreate: vi.fn(),
      }),
    );
    await flush();

    expect(
      testRoot.container.querySelector<HTMLSelectElement>(
        '[data-testid="agents-editor-tools-canonical-bundle"]',
      )?.value,
    ).toBe("workspace-default");
    expect(
      testRoot.container.querySelector<HTMLSelectElement>(
        '[data-testid="agents-editor-tools-canonical-tier"]',
      )?.value,
    ).toBe("default");

    cleanupTestRoot(testRoot);
  });
});
