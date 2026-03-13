// @vitest-environment jsdom

import { createElevatedModeStore, type OperatorCore } from "@tyrum/operator-core";
import type { ManagedExtensionDetail } from "@tyrum/schemas";
import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionsPage } from "../../src/components/pages/extensions-page.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

const mutationAccess = {
  canMutate: true,
  requestEnter: vi.fn(),
};

vi.mock("../../src/components/pages/admin-http-shared.js", () => ({
  useAdminHttpClient: () => ({ extensions: extensionsApi }),
  useAdminMutationAccess: () => mutationAccess,
}));

type ExtensionKind = "skill" | "mcp";

function cloneDetail<T>(value: T): T {
  return structuredClone(value);
}

function createSkillDetail(
  overrides: Partial<ManagedExtensionDetail> = {},
): ManagedExtensionDetail {
  return {
    kind: "skill",
    key: "agent-review",
    name: "Agent Review",
    description: "Review workflow",
    version: null,
    enabled: true,
    revision: 2,
    source: {
      kind: "direct-url",
      url: "https://example.com/skills/review.zip",
      filename: "review.zip",
    },
    refreshable: true,
    materialized_path: "/tmp/managed/skills/agent-review/SKILL.md",
    assignment_count: 1,
    transport: null,
    manifest: {
      meta: {
        id: "agent-review",
        name: "Agent Review",
        version: "1.0.0",
        description: "Review workflow",
      },
      body: "Review the target changes carefully.",
    },
    spec: null,
    files: ["SKILL.md", "references/checklist.md"],
    revisions: [
      {
        revision: 2,
        enabled: true,
        created_at: "2026-03-09T10:00:00.000Z",
        reason: "refresh",
        reverted_from_revision: null,
      },
      {
        revision: 1,
        enabled: true,
        created_at: "2026-03-08T10:00:00.000Z",
        reason: "import",
        reverted_from_revision: null,
      },
    ],
    ...overrides,
  };
}

function createMcpDetail(overrides: Partial<ManagedExtensionDetail> = {}): ManagedExtensionDetail {
  return {
    kind: "mcp",
    key: "filesystem",
    name: "Filesystem MCP",
    description: "File server",
    version: null,
    enabled: true,
    revision: 1,
    source: {
      kind: "npm",
      npm_spec: "@modelcontextprotocol/server-filesystem",
      command: "npx",
      args: ["-y"],
    },
    refreshable: true,
    materialized_path: "/tmp/managed/mcp/filesystem/server.yml",
    assignment_count: 2,
    transport: "stdio",
    manifest: null,
    spec: {
      id: "filesystem",
      name: "Filesystem MCP",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
    },
    files: ["server.yml"],
    revisions: [
      {
        revision: 1,
        enabled: true,
        created_at: "2026-03-09T10:00:00.000Z",
        reason: "import",
        reverted_from_revision: null,
      },
    ],
    ...overrides,
  };
}

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

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function setInput(container: HTMLElement, placeholder: string, value: string): Promise<void> {
  const input = Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
    (candidate) => candidate.placeholder === placeholder,
  );
  expect(input).toBeDefined();
  await act(async () => {
    setNativeValue(input!, value);
    await Promise.resolve();
  });
}

async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).toBeDefined();
  await act(async () => {
    button!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    button!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    button!.click();
    button!.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    button!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await Promise.resolve();
  });
}

async function clickTab(container: HTMLElement, label: string): Promise<void> {
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(tab).toBeDefined();
  await act(async () => {
    tab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
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
  it("loads, inspects, mutates, and imports managed extensions", async () => {
    const testRoot = renderIntoDocument(
      React.createElement(ExtensionsPage, { core: createCore() }),
    );
    try {
      await flush();

      expect(testRoot.container.textContent).toContain("Skills and MCP Servers");
      expect(testRoot.container.textContent).toContain("Agent Review");
      expect(testRoot.container.textContent).toContain("1 skills");
      expect(testRoot.container.textContent).toContain("1 MCP servers");

      await clickButton(testRoot.container, "Inspect");
      await flush();
      expect(extensionsApi.get).toHaveBeenCalledWith("skill", "agent-review");
      expect(testRoot.container.textContent).toContain("Revision history");
      expect(testRoot.container.textContent).toContain("Revision 2");

      await clickButton(testRoot.container, "Disable");
      await flush();
      expect(extensionsApi.toggle).toHaveBeenCalledWith("skill", "agent-review", {
        enabled: false,
      });
      expect(testRoot.container.textContent).toContain("disabled");

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

      await clickTab(testRoot.container, "MCP Servers");
      await flush();
      expect(testRoot.container.textContent).toContain("Filesystem MCP");

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
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("shows the elevated-mode guard when mutations are locked", async () => {
    mutationAccess.canMutate = false;
    const testRoot = renderIntoDocument(
      React.createElement(ExtensionsPage, { core: createCore() }),
    );
    try {
      await flush();

      expect(testRoot.container.textContent).toContain("Admin access required");
      await clickButton(testRoot.container, "Authorize admin access");
      expect(mutationAccess.requestEnter).toHaveBeenCalledTimes(1);
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
