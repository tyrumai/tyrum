import type { ManagedExtensionDetail } from "@tyrum/schemas";
import React, { act } from "react";
import { expect } from "vitest";
import { setNativeValue } from "../test-utils.js";

type ExtensionKind = "skill" | "mcp";

export type ExtensionApiMock = {
  list: ReturnType<typeof import("vitest").vi.fn>;
  get: ReturnType<typeof import("vitest").vi.fn>;
  importSkill: ReturnType<typeof import("vitest").vi.fn>;
  uploadSkill: ReturnType<typeof import("vitest").vi.fn>;
  importMcp: ReturnType<typeof import("vitest").vi.fn>;
  uploadMcp: ReturnType<typeof import("vitest").vi.fn>;
  toggle: ReturnType<typeof import("vitest").vi.fn>;
  refresh: ReturnType<typeof import("vitest").vi.fn>;
  revert: ReturnType<typeof import("vitest").vi.fn>;
  updateDefaults: ReturnType<typeof import("vitest").vi.fn>;
};

export function cloneDetail<T>(value: T): T {
  return structuredClone(value);
}

export function createSkillDetail(
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
    source_type: "managed",
    source: {
      kind: "direct-url",
      url: "https://example.com/skills/review.zip",
      filename: "review.zip",
    },
    refreshable: true,
    materialized_path: "/tmp/managed/skills/agent-review/SKILL.md",
    assignment_count: 1,
    transport: null,
    default_access: "inherit",
    can_edit_settings: false,
    can_toggle_source_enabled: true,
    can_refresh_source: true,
    can_revert_source: true,
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
    default_mcp_server_settings_json: null,
    default_mcp_server_settings_yaml: null,
    sources: [
      {
        source_type: "managed",
        is_effective: true,
        enabled: true,
        revision: 2,
        refreshable: true,
        materialized_path: "/tmp/managed/skills/agent-review/SKILL.md",
        transport: null,
        version: null,
        description: "Review workflow",
        source: {
          kind: "direct-url",
          url: "https://example.com/skills/review.zip",
          filename: "review.zip",
        },
      },
    ],
    ...overrides,
  };
}

export function createMcpDetail(
  overrides: Partial<ManagedExtensionDetail> = {},
): ManagedExtensionDetail {
  return {
    kind: "mcp",
    key: "filesystem",
    name: "Filesystem MCP",
    description: "File server",
    version: null,
    enabled: true,
    revision: 1,
    source_type: "managed",
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
    default_access: "inherit",
    can_edit_settings: true,
    can_toggle_source_enabled: true,
    can_refresh_source: true,
    can_revert_source: true,
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
    default_mcp_server_settings_json: {
      semantic: {
        enabled: true,
        limit: 20,
      },
    },
    default_mcp_server_settings_yaml: `semantic:
  enabled: true
  limit: 20
`,
    sources: [
      {
        source_type: "managed",
        is_effective: true,
        enabled: true,
        revision: 1,
        refreshable: true,
        materialized_path: "/tmp/managed/mcp/filesystem/server.yml",
        transport: "stdio",
        version: null,
        description: "File server",
        source: {
          kind: "npm",
          npm_spec: "@modelcontextprotocol/server-filesystem",
          command: "npx",
          args: ["-y"],
        },
      },
    ],
    ...overrides,
  };
}

export function createBuiltinMemoryDetail(
  overrides: Partial<ManagedExtensionDetail> = {},
): ManagedExtensionDetail {
  return {
    kind: "mcp",
    key: "memory",
    name: "Memory",
    description: null,
    version: null,
    enabled: true,
    revision: null,
    source_type: "builtin",
    source: null,
    refreshable: false,
    materialized_path: null,
    assignment_count: 0,
    transport: "stdio",
    default_access: "inherit",
    can_edit_settings: true,
    can_toggle_source_enabled: false,
    can_refresh_source: false,
    can_revert_source: false,
    manifest: null,
    spec: {
      id: "memory",
      name: "Memory",
      enabled: true,
      transport: "stdio",
      command: "node",
      args: ["-e", ""],
    },
    files: [],
    revisions: [],
    default_mcp_server_settings_json: {
      enabled: true,
      allow_sensitivities: ["public", "private"],
      structured: {
        fact_keys: ["user_name"],
        tags: ["identity"],
      },
      keyword: {
        enabled: true,
        limit: 8,
      },
      semantic: {
        enabled: true,
        limit: 9,
      },
      budgets: {
        max_total_items: 8,
        max_total_chars: 12000,
        per_kind: {
          fact: { max_items: 4, max_chars: 1000 },
          note: { max_items: 2, max_chars: 6000 },
          procedure: { max_items: 1, max_chars: 3000 },
          episode: { max_items: 1, max_chars: 2000 },
        },
      },
    },
    default_mcp_server_settings_yaml: `enabled: true
allow_sensitivities:
  - public
  - private
structured:
  fact_keys:
    - user_name
  tags:
    - identity
keyword:
  enabled: true
  limit: 8
semantic:
  enabled: true
  limit: 9
budgets:
  max_total_items: 8
  max_total_chars: 12000
  per_kind:
    fact:
      max_items: 4
      max_chars: 1000
    note:
      max_items: 2
      max_chars: 6000
    procedure:
      max_items: 1
      max_chars: 3000
    episode:
      max_items: 1
      max_chars: 2000
`,
    sources: [
      {
        source_type: "builtin",
        is_effective: true,
        enabled: true,
        revision: null,
        refreshable: false,
        materialized_path: null,
        transport: "stdio",
        version: null,
        description: null,
        source: null,
      },
    ],
    ...overrides,
  };
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export async function setInput(
  container: HTMLElement,
  placeholder: string,
  value: string,
): Promise<void> {
  const input = Array.from(container.querySelectorAll<HTMLInputElement>("input")).find(
    (candidate) => candidate.placeholder === placeholder,
  );
  expect(input).toBeDefined();
  await act(async () => {
    setNativeValue(input!, value);
    await Promise.resolve();
  });
}

export async function clickButton(container: HTMLElement, label: string): Promise<void> {
  const activePanel = container.querySelector<HTMLElement>(
    '[role="tabpanel"][data-state="active"]',
  );
  const searchRoots = activePanel ? [activePanel, container] : [container];
  const button = searchRoots
    .flatMap((root) => Array.from(root.querySelectorAll<HTMLButtonElement>("button")))
    .find((candidate) => candidate.textContent?.trim() === label);
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

export async function setSelect(
  container: HTMLElement,
  label: string,
  value: string,
): Promise<void> {
  const labelNode = Array.from(container.querySelectorAll<HTMLLabelElement>("label")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(labelNode?.htmlFor).toBeTruthy();
  const select = container.querySelector<HTMLSelectElement>(`#${labelNode!.htmlFor}`);
  expect(select).toBeDefined();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, value);
    select!.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

export async function setTextarea(
  container: HTMLElement,
  label: string,
  value: string,
): Promise<void> {
  const labelNode = Array.from(container.querySelectorAll<HTMLLabelElement>("label")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(labelNode?.htmlFor).toBeTruthy();
  const textarea = container.querySelector<HTMLTextAreaElement>(`#${labelNode!.htmlFor}`);
  expect(textarea).toBeDefined();
  await act(async () => {
    setNativeValue(textarea!, value);
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    textarea!.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

export function findLabeledControl(
  container: HTMLElement,
  labelText: string,
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const label = Array.from(container.querySelectorAll("label")).find((candidate) => {
    return candidate.textContent?.replace(/\s+/gu, " ").trim() === labelText;
  });
  if (!(label instanceof HTMLLabelElement)) {
    throw new Error(`Missing label: ${labelText}`);
  }
  const control =
    (label.htmlFor ? container.querySelector(`#${label.htmlFor}`) : null) ??
    label.parentElement?.querySelector("input, textarea, select");
  if (
    !(
      control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement ||
      control instanceof HTMLSelectElement
    )
  ) {
    throw new Error(`Missing control for label: ${labelText}`);
  }
  return control;
}

export async function setLabeledInput(
  container: HTMLElement,
  label: string,
  value: string,
): Promise<void> {
  const control = findLabeledControl(container, label);
  if (!(control instanceof HTMLInputElement)) {
    throw new Error(`Expected input for label: ${label}`);
  }
  await act(async () => {
    setNativeValue(control, value);
    await Promise.resolve();
  });
}

export async function toggleLabeledSwitch(
  container: HTMLElement,
  labelText: string,
): Promise<void> {
  const label = Array.from(container.querySelectorAll("label")).find((candidate) => {
    return candidate.textContent?.replace(/\s+/gu, " ").trim() === labelText;
  });
  const button = label?.querySelector<HTMLElement>("button");
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

export async function clickTab(container: HTMLElement, label: string): Promise<void> {
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(tab).toBeDefined();
  await act(async () => {
    tab!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
}

export function updateMockExtensionDetail(
  current: ManagedExtensionDetail,
  input: {
    default_access: "inherit" | "allow" | "deny";
    settings_format?: "json" | "yaml";
    settings_text?: string;
  },
): ManagedExtensionDetail {
  return createMcpDetail({
    ...current,
    default_access: input.default_access,
    default_mcp_server_settings_json:
      typeof input.settings_text === "string" && input.settings_format === "json"
        ? (JSON.parse(input.settings_text) as Record<string, unknown>)
        : current.default_mcp_server_settings_json,
    default_mcp_server_settings_yaml:
      typeof input.settings_text === "string"
        ? input.settings_text
        : current.default_mcp_server_settings_yaml,
  });
}

export type { ExtensionKind };
