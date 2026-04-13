// @vitest-environment jsdom

import { AgentConfig } from "@tyrum/contracts";
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentsPageEditor } from "../../src/components/pages/agents-page-editor.js";
import { AgentsPage } from "../../src/components/pages/agents-page.js";
import {
  createCore,
  flush,
  sampleManagedAgentDetail,
  sampleMcpExtensionDetail,
  samplePresets,
  setLabeledValue,
} from "./agents-page-editor.test-helpers.js";
import { waitForSelector } from "../operator-ui.test-support.js";
import {
  cleanupTestRoot,
  click,
  renderIntoDocument,
  setNativeValue,
  setStructuredJsonObjectField,
} from "../test-utils.js";

describe("AgentsPage editor", () => {
  it("preloads the selected agent into the editor and saves through update", async () => {
    const list = vi.fn(async () => ({
      agents: [
        {
          agent_key: "default",
          agent_id: "11111111-1111-4111-8111-111111111111",
          can_delete: false,
          persona: { name: "Feynman" },
        },
        {
          agent_key: "agent-1",
          agent_id: "22222222-2222-4222-8222-222222222222",
          can_delete: true,
          persona: { name: "Ada" },
        },
      ],
    }));
    const get = vi.fn().mockResolvedValue(sampleManagedAgentDetail("agent-1"));
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
      tools: { default_mode: "allow", allow: [], deny: [], items: [] },
    }));
    const update = vi.fn().mockResolvedValue(sampleManagedAgentDetail("agent-1"));
    const core = createCore(list, get, capabilities, update);

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();
    expect(get).not.toHaveBeenCalled();

    await act(async () => {
      click(testRoot.container.querySelector<HTMLElement>('[data-testid="agents-edit-agent-1"]')!);
      await Promise.resolve();
    });
    expect(get).toHaveBeenLastCalledWith("agent-1");

    const dialog = await waitForSelector(document.body, '[data-testid="agents-editor-dialog"]');
    const saveButton = await waitForSelector<HTMLButtonElement>(
      dialog,
      '[data-testid="agents-editor-save"]',
    );

    await act(async () => {
      click(saveButton);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ config: expect.any(Object) }),
    );
    cleanupTestRoot(testRoot);
  });

  it("preserves hidden MCP settings when saving an existing agent", async () => {
    const list = vi.fn(async () => ({
      agents: [
        {
          agent_key: "default",
          agent_id: "11111111-1111-4111-8111-111111111111",
          can_delete: false,
          persona: { name: "Feynman" },
        },
      ],
    }));
    const existingDetail = {
      ...sampleManagedAgentDetail("default"),
      config: AgentConfig.parse({
        ...sampleManagedAgentDetail("default").config,
        mcp: {
          default_mode: "deny",
          allow: ["filesystem"],
          deny: ["secrets"],
          pre_turn_tools: ["mcp.memory.seed"],
          server_settings: {
            filesystem: {
              namespace: "shared",
            },
            memory: {
              enabled: true,
            },
          },
        },
      }),
    };
    const get = vi.fn().mockResolvedValue(existingDetail);
    const capabilities = vi.fn(async () => ({
      skills: { default_mode: "allow", allow: [], deny: [], workspace_trusted: true, items: [] },
      mcp: {
        default_mode: "deny",
        allow: ["filesystem"],
        deny: ["secrets"],
        items: [
          {
            id: "memory",
            name: "Memory",
            transport: "stdio" as const,
            source: "builtin" as const,
          },
          {
            id: "filesystem",
            name: "Filesystem",
            transport: "stdio" as const,
            source: "workspace" as const,
          },
        ],
      },
      tools: { default_mode: "allow", allow: [], deny: [], items: [] },
    }));
    const update = vi.fn().mockResolvedValue(existingDetail);
    const core = createCore(list, get, capabilities, update);

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    await act(async () => {
      click(testRoot.container.querySelector<HTMLElement>('[data-testid="agents-edit-default"]')!);
      await Promise.resolve();
    });

    const dialog = await waitForSelector(document.body, '[data-testid="agents-editor-dialog"]');
    const saveButton = await waitForSelector<HTMLButtonElement>(
      dialog,
      '[data-testid="agents-editor-save"]',
    );

    await act(async () => {
      click(saveButton);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(update).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        config: expect.objectContaining({
          mcp: expect.objectContaining({
            default_mode: "deny",
            allow: ["filesystem"],
            deny: ["secrets"],
            pre_turn_tools: ["memory.seed"],
            server_settings: expect.objectContaining({
              filesystem: expect.objectContaining({
                namespace: "shared",
              }),
              memory: expect.objectContaining({
                enabled: true,
              }),
            }),
          }),
        }),
      }),
    );

    cleanupTestRoot(testRoot);
  });

  it("replaces a legacy model with a configured preset and persists its options", async () => {
    const list = vi.fn(async () => ({
      agents: [
        {
          agent_key: "default",
          agent_id: "11111111-1111-4111-8111-111111111111",
          can_delete: false,
          persona: { name: "Feynman" },
        },
      ],
    }));
    const get = vi.fn().mockResolvedValue(sampleManagedAgentDetail("default"));
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
      tools: { default_mode: "allow", allow: [], deny: [], items: [] },
    }));
    const update = vi.fn().mockResolvedValue(sampleManagedAgentDetail("default"));
    const listPresets = vi.fn().mockResolvedValue(samplePresets());
    const core = createCore(list, get, capabilities, update, listPresets);

    const testRoot = renderIntoDocument(React.createElement(AgentsPage, { core }));
    await flush();

    await act(async () => {
      click(testRoot.container.querySelector<HTMLElement>('[data-testid="agents-edit-default"]')!);
      await Promise.resolve();
    });

    const dialog = await waitForSelector(document.body, '[data-testid="agents-editor-dialog"]');
    const primaryToggle = await waitForSelector<HTMLElement>(
      dialog,
      '[data-testid="agents-editor-primary-model-toggle"]',
    );
    const saveButton = await waitForSelector<HTMLButtonElement>(
      dialog,
      '[data-testid="agents-editor-save"]',
    );

    await act(async () => {
      click(primaryToggle);
      await Promise.resolve();
    });

    const primaryOption = document.body.querySelector<HTMLElement>(
      '[data-testid="agents-editor-primary-model-option-claude-opus-4-6-high"]',
    );
    expect(primaryOption).not.toBeNull();

    await act(async () => {
      if (primaryOption) click(primaryOption);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      if (saveButton) click(saveButton);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listPresets).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      "default",
      expect.objectContaining({
        config: expect.objectContaining({
          model: expect.objectContaining({
            model: "openrouter/anthropic/claude-opus-4.6",
            options: { reasoning_effort: "high" },
          }),
        }),
      }),
    );

    cleanupTestRoot(testRoot);
  });

  it("supports inheriting memory defaults and overriding another MCP server with structured JSON", async () => {
    const list = vi.fn(async () => ({
      agents: [
        {
          agent_key: "default",
          agent_id: "11111111-1111-4111-8111-111111111111",
          can_delete: false,
          persona: { name: "Feynman" },
        },
      ],
    }));
    const existingDetail = {
      ...sampleManagedAgentDetail("default"),
      config: AgentConfig.parse({
        ...sampleManagedAgentDetail("default").config,
        mcp: {
          default_mode: "allow",
          allow: ["memory", "filesystem"],
          deny: [],
          pre_turn_tools: ["mcp.memory.seed"],
          server_settings: {
            memory: {
              enabled: false,
            },
          },
        },
      }),
    };
    const get = vi.fn().mockResolvedValue(existingDetail);
    const capabilities = vi.fn(async () => ({
      skills: { default_mode: "allow", allow: [], deny: [], workspace_trusted: true, items: [] },
      mcp: {
        default_mode: "allow",
        allow: ["memory", "filesystem"],
        deny: [],
        items: [
          {
            id: "memory",
            name: "Memory",
            transport: "stdio" as const,
            source: "builtin" as const,
          },
          {
            id: "filesystem",
            name: "Filesystem",
            transport: "stdio" as const,
            source: "managed" as const,
          },
        ],
      },
      tools: { default_mode: "allow", allow: [], deny: [], items: [] },
    }));
    const update = vi.fn().mockResolvedValue(existingDetail);
    const extensions = {
      list: vi.fn().mockResolvedValue({
        items: [sampleMcpExtensionDetail("memory"), sampleMcpExtensionDetail("filesystem")],
      }),
      get: vi.fn(async (_kind: "mcp", key: string) => ({
        item: sampleMcpExtensionDetail(key),
      })),
    };
    const core = createCore(
      list,
      get,
      capabilities,
      update,
      vi.fn().mockResolvedValue(samplePresets()),
      extensions,
    );

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

    act(() => {
      setLabeledValue(testRoot.container, "Memory settings mode", "inherit");
      setLabeledValue(testRoot.container, "Settings mode for Filesystem", "override");
    });
    await setStructuredJsonObjectField(testRoot.container, "structured-json-override-filesystem", {
      key: "namespace",
      value: "workspace",
    });
    await flush();

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
          mcp: expect.objectContaining({
            server_settings: {
              filesystem: {
                namespace: "workspace",
              },
            },
          }),
        }),
      }),
    );

    cleanupTestRoot(testRoot);
  });

  it("debounces capability lookups while typing a new agent key", async () => {
    vi.useFakeTimers();
    try {
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
        tools: { default_mode: "allow", allow: [], deny: [], items: [] },
      }));
      const core = createCore(vi.fn(), vi.fn(), capabilities, vi.fn());

      const testRoot = renderIntoDocument(
        React.createElement(AgentsPageEditor, {
          core,
          mode: "create",
          createNonce: 1,
          onSaved: vi.fn(),
          onCancelCreate: vi.fn(),
        }),
      );
      await flush();

      expect(capabilities).toHaveBeenCalledTimes(1);
      expect(capabilities).toHaveBeenLastCalledWith("default");

      const agentKeyInput = testRoot.container.querySelector<HTMLInputElement>(
        '[data-testid="agents-editor-agent-key"]',
      );
      expect(agentKeyInput).not.toBeNull();

      act(() => {
        if (agentKeyInput) {
          setNativeValue(agentKeyInput, "agent-draft");
        }
      });
      await flush();

      expect(capabilities).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(249);
        await Promise.resolve();
      });
      expect(capabilities).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(1);
        await Promise.resolve();
      });
      await flush();

      expect(capabilities).toHaveBeenCalledTimes(2);
      expect(capabilities).toHaveBeenLastCalledWith("agent-draft");

      cleanupTestRoot(testRoot);
    } finally {
      vi.useRealTimers();
    }
  });
});
