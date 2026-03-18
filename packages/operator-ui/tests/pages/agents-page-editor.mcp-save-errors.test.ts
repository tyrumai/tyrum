// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { AgentsPageEditor } from "../../src/components/pages/agents-page-editor.js";
import {
  createCore,
  flush,
  sampleManagedAgentDetail,
  sampleMcpExtensionDetail,
  samplePresets,
  setLabeledValue,
} from "./agents-page-editor.test-helpers.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";

function createCapabilities() {
  return {
    skills: {
      default_mode: "allow" as const,
      allow: [],
      deny: [],
      workspace_trusted: true,
      items: [],
    },
    mcp: {
      default_mode: "allow" as const,
      allow: ["filesystem"],
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
    tools: { default_mode: "allow" as const, allow: [], deny: [], items: [] },
  };
}

function createExtensions(overrides?: {
  parseMcpSettings?: (input: {
    settings_format: "json" | "yaml";
    settings_text: string;
  }) => Promise<{ settings: Record<string, unknown> }>;
}) {
  return {
    list: vi.fn().mockResolvedValue({
      items: [sampleMcpExtensionDetail("memory"), sampleMcpExtensionDetail("filesystem")],
    }),
    get: vi.fn(async (_kind: "mcp", key: string) => ({
      item: sampleMcpExtensionDetail(key),
    })),
    parseMcpSettings:
      overrides?.parseMcpSettings ??
      vi.fn(async ({ settings_text }: { settings_text: string }) => ({
        settings: { raw: settings_text },
      })),
  };
}

async function renderEditor(input: {
  update: ReturnType<typeof vi.fn>;
  onSaved: ReturnType<typeof vi.fn>;
  extensions: ReturnType<typeof createExtensions>;
}) {
  const core = createCore(
    vi.fn(async () => ({
      agents: [
        {
          agent_key: "default",
          agent_id: "11111111-1111-4111-8111-111111111111",
          can_delete: false,
          persona: { name: "Feynman" },
        },
      ],
    })),
    vi.fn().mockResolvedValue(sampleManagedAgentDetail("default")),
    vi.fn(async () => createCapabilities()),
    input.update,
    vi.fn().mockResolvedValue(samplePresets()),
    input.extensions,
  );
  const testRoot = renderIntoDocument(
    React.createElement(AgentsPageEditor, {
      core,
      mode: "edit",
      createNonce: 1,
      agentKey: "default",
      onSaved: input.onSaved,
      onCancelCreate: vi.fn(),
    }),
  );
  await flush();
  return testRoot;
}

async function clickSave(container: HTMLElement) {
  const saveButton = container.querySelector<HTMLButtonElement>(
    '[data-testid="agents-editor-save"]',
  );
  expect(saveButton).not.toBeNull();
  await act(async () => {
    if (saveButton) click(saveButton);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AgentsPage editor MCP save errors", () => {
  it("surfaces invalid JSON MCP override errors through the save alert", async () => {
    const update = vi.fn();
    const onSaved = vi.fn();
    const extensions = createExtensions();
    const testRoot = await renderEditor({ update, onSaved, extensions });

    act(() => {
      setLabeledValue(testRoot.container, "Settings mode for Filesystem", "override");
      setLabeledValue(testRoot.container, "Settings format for Filesystem", "json");
      setLabeledValue(testRoot.container, "Server settings for Filesystem", "{");
    });
    await flush();
    await clickSave(testRoot.container);

    expect(update).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();

    cleanupTestRoot(testRoot);
  });

  it("surfaces MCP settings parse request failures through the save alert", async () => {
    const update = vi.fn();
    const onSaved = vi.fn();
    const extensions = createExtensions({
      parseMcpSettings: vi.fn(async () => {
        throw new Error("parse failed");
      }),
    });
    const testRoot = await renderEditor({ update, onSaved, extensions });

    act(() => {
      setLabeledValue(testRoot.container, "Settings mode for Filesystem", "override");
      setLabeledValue(testRoot.container, "Settings format for Filesystem", "yaml");
      setLabeledValue(testRoot.container, "Server settings for Filesystem", "namespace: shared\n");
    });
    await flush();
    await clickSave(testRoot.container);

    expect(extensions.parseMcpSettings).toHaveBeenCalledWith({
      settings_format: "yaml",
      settings_text: "namespace: shared\n",
    });
    expect(update).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();

    cleanupTestRoot(testRoot);
  });
});
