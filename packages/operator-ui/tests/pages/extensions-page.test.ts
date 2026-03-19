// @vitest-environment jsdom

import { createElevatedModeStore, type OperatorCore } from "@tyrum/operator-core";
import type { ManagedExtensionDetail } from "@tyrum/contracts";
import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionsPage } from "../../src/components/pages/extensions-page.js";
import {
  clickButton,
  clickTab,
  cloneDetail,
  createBuiltinMemoryDetail,
  createMcpDetail,
  createSkillDetail,
  findButtonByText,
  flush,
  setInput,
  setLabeledInput,
  setSelect,
  setTextarea,
  toggleLabeledSwitch,
  updateMockExtensionDetail,
  type ExtensionKind,
} from "./extensions-page.test-helpers.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

const mutationAccess = {
  canMutate: true,
  requestEnter: vi.fn(),
};

vi.mock("../../src/components/pages/admin-http-shared.js", () => ({
  useAdminHttpClient: () => ({ extensions: extensionsApi }),
  useAdminMutationHttpClient: () =>
    mutationAccess.canMutate ? { extensions: extensionsApi } : null,
  useAdminMutationAccess: () => mutationAccess,
}));

let skillDetail: ManagedExtensionDetail;
let mcpDetail: ManagedExtensionDetail;

const extensionsApi = {
  list: vi.fn(async (kind: ExtensionKind) => ({
    items: [cloneDetail(kind === "skill" ? skillDetail : mcpDetail)],
  })),
  get: vi.fn(async (kind: ExtensionKind, key: string) => ({
    item: cloneDetail(kind === "skill" && key === skillDetail.key ? skillDetail : mcpDetail),
  })),
  importSkill: vi.fn(async ({ url }: { url: string }) => {
    skillDetail = createSkillDetail({
      key: "imported-skill",
      name: "Imported Skill",
      description: `Imported from ${url}`,
      revision: 3,
      source: { kind: "direct-url", url, filename: "imported.zip" },
      materialized_path: "/tmp/managed/skills/imported-skill/SKILL.md",
      revisions: [
        {
          revision: 3,
          enabled: true,
          created_at: "2026-03-09T11:00:00.000Z",
          reason: "import",
          reverted_from_revision: null,
        },
      ],
    });
    return { item: cloneDetail(skillDetail) };
  }),
  uploadSkill: vi.fn(async ({ filename }: { filename: string }) => {
    skillDetail = createSkillDetail({
      key: "uploaded-skill",
      name: "Uploaded Skill",
      description: `Uploaded from ${filename}`,
      revision: 4,
      source: { kind: "upload", filename },
      refreshable: false,
      materialized_path: "/tmp/managed/skills/uploaded-skill/SKILL.md",
      revisions: [
        {
          revision: 4,
          enabled: true,
          created_at: "2026-03-09T12:00:00.000Z",
          reason: "upload",
          reverted_from_revision: null,
        },
      ],
    });
    return { item: cloneDetail(skillDetail) };
  }),
  importMcp: vi.fn(
    async (input: { source: "direct-url"; url: string } | { source: "npm"; npm_spec: string }) => {
      mcpDetail =
        input.source === "npm"
          ? createMcpDetail({
              key: "imported-mcp",
              name: "Imported MCP",
              revision: 2,
              source: {
                kind: "npm",
                npm_spec: input.npm_spec,
                command: "npx",
                args: ["-y"],
              },
              spec: {
                id: "imported-mcp",
                name: "Imported MCP",
                enabled: true,
                transport: "stdio",
                command: "npx",
                args: ["-y", input.npm_spec],
              },
              revisions: [
                {
                  revision: 2,
                  enabled: true,
                  created_at: "2026-03-09T11:30:00.000Z",
                  reason: "import",
                  reverted_from_revision: null,
                },
              ],
            })
          : createMcpDetail({
              key: "remote-mcp",
              name: "Remote MCP",
              revision: 2,
              source: { kind: "direct-url", url: input.url, mode: "remote", filename: null },
              transport: "remote",
              spec: {
                id: "remote-mcp",
                name: "Remote MCP",
                enabled: true,
                transport: "remote",
                url: input.url,
              },
              revisions: [
                {
                  revision: 2,
                  enabled: true,
                  created_at: "2026-03-09T11:30:00.000Z",
                  reason: "import",
                  reverted_from_revision: null,
                },
              ],
            });
      return { item: cloneDetail(mcpDetail) };
    },
  ),
  uploadMcp: vi.fn(async ({ filename }: { filename: string }) => {
    mcpDetail = createMcpDetail({
      key: "uploaded-mcp",
      name: "Uploaded MCP",
      source: { kind: "upload", filename },
      refreshable: false,
    });
    return { item: cloneDetail(mcpDetail) };
  }),
  toggle: vi.fn(async (kind: ExtensionKind, key: string, { enabled }: { enabled: boolean }) => {
    if (kind === "skill" && key === skillDetail.key) {
      skillDetail = createSkillDetail({ ...skillDetail, enabled });
      return { item: cloneDetail(skillDetail) };
    }
    mcpDetail = createMcpDetail({ ...mcpDetail, enabled });
    return { item: cloneDetail(mcpDetail) };
  }),
  refresh: vi.fn(async (kind: ExtensionKind, key: string) => ({
    item: cloneDetail(kind === "skill" && key === skillDetail.key ? skillDetail : mcpDetail),
  })),
  revert: vi.fn(async (kind: ExtensionKind, key: string, { revision }: { revision: number }) => {
    if (kind === "skill" && key === skillDetail.key) {
      skillDetail = createSkillDetail({ ...skillDetail, revision });
      return { item: cloneDetail(skillDetail) };
    }
    mcpDetail = createMcpDetail({ ...mcpDetail, revision });
    return { item: cloneDetail(mcpDetail) };
  }),
  updateDefaults: vi.fn(
    async (
      kind: ExtensionKind,
      key: string,
      input: {
        default_access: "inherit" | "allow" | "deny";
        settings_format?: "json" | "yaml";
        settings_text?: string;
      },
    ) => {
      if (kind === "skill" && key === skillDetail.key) {
        skillDetail = createSkillDetail({
          ...skillDetail,
          default_access: input.default_access,
        });
        return { item: cloneDetail(skillDetail) };
      }
      mcpDetail = updateMockExtensionDetail(mcpDetail, input);
      return { item: cloneDetail(mcpDetail) };
    },
  ),
};

function createCore(): OperatorCore {
  return {
    httpBaseUrl: "http://example.test",
    elevatedModeStore: createElevatedModeStore({ tickIntervalMs: 0, now: () => Date.now() }),
    http: {
      extensions: extensionsApi,
    },
  } as unknown as OperatorCore;
}

beforeEach(() => {
  skillDetail = createSkillDetail();
  mcpDetail = createMcpDetail();
  mutationAccess.canMutate = true;
  mutationAccess.requestEnter.mockReset();
  for (const api of Object.values(extensionsApi)) {
    api.mockClear();
  }
});

describe("ExtensionsPage", () => {
  it("loads inventories, toggles inspect, preserves per-tab expansion, mutates, and switches tabs after imports", async () => {
    const testRoot = renderIntoDocument(
      React.createElement(ExtensionsPage, { core: createCore() }),
    );
    try {
      await flush();

      expect(testRoot.container.textContent).toContain("Skills and MCP Servers");
      expect(testRoot.container.textContent).toContain("Agent Review");
      expect(testRoot.container.textContent).toContain("1 skills");
      expect(testRoot.container.textContent).toContain("1 MCP servers");
      expect(testRoot.container.textContent).not.toContain("Archive or SKILL.md URL");
      expect(testRoot.container.textContent).not.toContain("Remote endpoint URL");

      const inspectButton = findButtonByText(testRoot.container, "Inspect");
      expect(inspectButton?.getAttribute("aria-expanded")).toBe("false");

      await clickButton(testRoot.container, "Inspect");
      await flush();
      expect(extensionsApi.get).toHaveBeenCalledWith("skill", "agent-review");
      expect(testRoot.container.textContent).toContain("Revision history");
      expect(findButtonByText(testRoot.container, "Collapse")?.getAttribute("aria-expanded")).toBe(
        "true",
      );

      await clickButton(testRoot.container, "Collapse");
      await flush();
      expect(testRoot.container.textContent).not.toContain("Revision history");

      await clickButton(testRoot.container, "Inspect");
      await flush();
      expect(testRoot.container.textContent).toContain("Revision history");

      await clickTab(testRoot.container, "MCP Servers");
      await flush();
      await clickButton(testRoot.container, "Inspect");
      await flush();
      expect(extensionsApi.get).toHaveBeenCalledWith("mcp", "filesystem");
      expect(testRoot.container.textContent).toContain("Filesystem MCP");
      expect(testRoot.container.textContent).toContain("Revision history");

      await clickTab(testRoot.container, "Skills");
      await flush();
      expect(testRoot.container.textContent).toContain("Agent Review");
      expect(testRoot.container.textContent).toContain("Revision history");

      await clickButton(testRoot.container, "Disable");
      await flush();
      expect(extensionsApi.toggle).toHaveBeenCalledWith("skill", "agent-review", {
        enabled: false,
      });
      expect(testRoot.container.textContent).toContain("disabled");

      await clickTab(testRoot.container, "MCP Servers");
      await flush();
      await clickButton(testRoot.container, "Import Skill");
      await flush();
      await setInput(
        testRoot.container,
        "https://example.com/skill.zip",
        "https://example.com/imported-skill.zip",
      );
      await clickButton(testRoot.container, "Import URL");
      await flush();
      expect(extensionsApi.importSkill).toHaveBeenCalledWith({
        url: "https://example.com/imported-skill.zip",
      });
      expect(testRoot.container.textContent).toContain("Imported Skill");
      expect(testRoot.container.textContent).not.toContain("Archive or SKILL.md URL");

      await clickButton(testRoot.container, "Import MCP Server");
      await flush();
      await setInput(
        testRoot.container,
        "@modelcontextprotocol/server-filesystem",
        "@modelcontextprotocol/server-memory",
      );
      await clickButton(testRoot.container, "Import npm");
      await flush();
      expect(extensionsApi.importMcp).toHaveBeenCalledWith({
        source: "npm",
        npm_spec: "@modelcontextprotocol/server-memory",
      });
      expect(testRoot.container.textContent).toContain("Imported MCP");
      expect(testRoot.container.textContent).not.toContain("npm spec");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("keeps only one extension expanded per list", async () => {
    const primarySkill = createSkillDetail({
      revisions: [
        {
          revision: 2,
          enabled: true,
          created_at: "2026-03-09T10:00:00.000Z",
          reason: "review-detail",
          reverted_from_revision: null,
        },
      ],
    });
    const secondarySkill = createSkillDetail({
      key: "triage-skill",
      name: "Triage Skill",
      description: "Sorts incoming work",
      manifest: {
        meta: {
          id: "triage-skill",
          name: "Triage Skill",
          version: "1.0.0",
          description: "Sorts incoming work",
        },
        body: "Triage requests before escalation.",
      },
      revisions: [
        {
          revision: 1,
          enabled: true,
          created_at: "2026-03-09T09:00:00.000Z",
          reason: "triage-detail",
          reverted_from_revision: null,
        },
      ],
    });

    extensionsApi.list.mockImplementation(async (kind: ExtensionKind) => ({
      items:
        kind === "skill"
          ? [cloneDetail(primarySkill), cloneDetail(secondarySkill)]
          : [cloneDetail(mcpDetail)],
    }));
    extensionsApi.get.mockImplementation(async (kind: ExtensionKind, key: string) => ({
      item: cloneDetail(
        kind === "skill" && key === secondarySkill.key
          ? secondarySkill
          : kind === "skill"
            ? primarySkill
            : mcpDetail,
      ),
    }));

    const testRoot = renderIntoDocument(
      React.createElement(ExtensionsPage, { core: createCore() }),
    );
    try {
      await flush();

      await clickButton(testRoot.container, "Inspect");
      await flush();
      expect(testRoot.container.textContent).toContain("review-detail");

      const inspectButtons = Array.from(
        testRoot.container.querySelectorAll<HTMLButtonElement>("button"),
      ).filter((button) => button.textContent?.trim() === "Inspect");
      expect(inspectButtons).toHaveLength(1);
      await act(async () => {
        inspectButtons[0]?.click();
        await Promise.resolve();
      });
      await flush();

      expect(testRoot.container.textContent).not.toContain("review-detail");
      expect(testRoot.container.textContent).toContain("triage-detail");
      expect(testRoot.container.querySelectorAll('button[aria-expanded="true"]')).toHaveLength(1);
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("loads inventories without admin access and keeps import disclosures collapsed by default", async () => {
    mutationAccess.canMutate = false;
    const testRoot = renderIntoDocument(
      React.createElement(ExtensionsPage, { core: createCore() }),
    );
    try {
      await flush();

      expect(testRoot.container.textContent).toContain("Agent Review");
      expect(testRoot.container.textContent).toContain("Import Skill");
      expect(testRoot.container.textContent).toContain("Import MCP Server");
      expect(testRoot.container.textContent).not.toContain("Archive or SKILL.md URL");
      expect(testRoot.container.textContent).not.toContain("Remote endpoint URL");

      await clickTab(testRoot.container, "MCP Servers");
      await flush();
      expect(testRoot.container.textContent).toContain("Filesystem MCP");
      await clickTab(testRoot.container, "Skills");
      await flush();

      await clickButton(testRoot.container, "Import Skill");
      await flush();
      expect(testRoot.container.textContent).toContain("Admin access required");
      expect(testRoot.container.textContent).toContain("Archive or SKILL.md URL");

      await clickButton(testRoot.container, "Authorize admin access");
      expect(mutationAccess.requestEnter).toHaveBeenCalledTimes(1);
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("updates shared defaults and MCP settings from the inspect panel", async () => {
    const testRoot = renderIntoDocument(
      React.createElement(ExtensionsPage, { core: createCore() }),
    );
    try {
      await flush();
      await clickTab(testRoot.container, "MCP Servers");
      await flush();

      await clickButton(testRoot.container, "Inspect");
      await flush();

      expect(testRoot.container.textContent).toContain("Discovered sources");
      expect(testRoot.container.textContent).toContain("Shared MCP server settings");

      await setSelect(testRoot.container, "Default access", "allow");
      await clickButton(testRoot.container, "Save access");
      await flush();

      expect(extensionsApi.updateDefaults).toHaveBeenCalledWith("mcp", "filesystem", {
        default_access: "allow",
      });

      await setTextarea(
        testRoot.container,
        "Default server settings",
        "semantic:\n  enabled: false\n  limit: 12\n",
      );
      await clickButton(testRoot.container, "Save settings");
      await flush();

      expect(extensionsApi.updateDefaults).toHaveBeenLastCalledWith("mcp", "filesystem", {
        default_access: "allow",
        settings_format: "yaml",
        settings_text: "semantic:\n  enabled: false\n  limit: 12\n",
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("uses a typed settings form for the built-in memory server", async () => {
    mcpDetail = createBuiltinMemoryDetail();
    const testRoot = renderIntoDocument(
      React.createElement(ExtensionsPage, { core: createCore() }),
    );
    try {
      await flush();
      await clickTab(testRoot.container, "MCP Servers");
      await flush();

      await clickButton(testRoot.container, "Inspect");
      await flush();

      expect(testRoot.container.textContent).toContain("Shared MCP server settings");
      expect(testRoot.container.textContent).toContain("Structured fact keys");
      expect(testRoot.container.textContent).not.toContain("Default server settings");
      expect(testRoot.container.textContent).not.toContain("Settings format");

      await toggleLabeledSwitch(testRoot.container, "Enable memory");
      await toggleLabeledSwitch(testRoot.container, "Sensitive");
      await setTextarea(testRoot.container, "Structured fact keys", "user_name\npreferred_name");
      await setTextarea(testRoot.container, "Structured tags", "identity\nprofile");
      await setLabeledInput(testRoot.container, "Keyword limit", "12");
      await setLabeledInput(testRoot.container, "Semantic limit", "14");
      await setLabeledInput(testRoot.container, "Total budget items", "10");

      await clickButton(testRoot.container, "Save settings");
      await flush();

      const lastCall = extensionsApi.updateDefaults.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe("mcp");
      expect(lastCall?.[1]).toBe("memory");
      expect(lastCall?.[2]).toMatchObject({
        default_access: "inherit",
        settings_format: "json",
      });
      const memorySettingsInput = lastCall?.[2];
      expect(memorySettingsInput).toBeDefined();
      expect(JSON.parse((memorySettingsInput as { settings_text: string }).settings_text)).toEqual({
        enabled: false,
        allow_sensitivities: ["public", "private", "sensitive"],
        structured: {
          fact_keys: ["user_name", "preferred_name"],
          tags: ["identity", "profile"],
        },
        keyword: {
          enabled: true,
          limit: 12,
        },
        semantic: {
          enabled: true,
          limit: 14,
        },
        budgets: {
          max_total_items: 10,
          max_total_chars: 12000,
          per_kind: {
            fact: { max_items: 4, max_chars: 1000 },
            note: { max_items: 2, max_chars: 6000 },
            procedure: { max_items: 1, max_chars: 3000 },
            episode: { max_items: 1, max_chars: 2000 },
          },
        },
      });
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
