import type { ManagedExtensionDetail } from "@tyrum/contracts";
import { setNativeValue } from "../test-utils.js";

export function findLabeledControl(
  container: HTMLElement,
  labelText: string,
): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  const label = Array.from(container.querySelectorAll("label")).find(
    (element) => element.textContent?.trim() === labelText,
  );
  if (!(label instanceof HTMLLabelElement) || !label.htmlFor) {
    throw new Error(`Missing label: ${labelText}`);
  }
  const control =
    container.ownerDocument.getElementById(label.htmlFor) ??
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

export function setLabeledValue(container: HTMLElement, labelText: string, value: string): void {
  const control = findLabeledControl(container, labelText);
  if (control instanceof HTMLSelectElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    if (setter) {
      setter.call(control, value);
    }
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  setNativeValue(control, value);
}

export function setMultiSelectValues(element: HTMLSelectElement, values: readonly string[]): void {
  const selected = new Set(values);
  for (const option of element.options) {
    option.selected = selected.has(option.value);
  }
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

export function findToggle(container: HTMLElement, labelText: string): HTMLElement {
  const label = Array.from(container.querySelectorAll("label")).find((element) => {
    return element.textContent?.replace(/\s+/gu, " ").trim() === labelText;
  });
  const button = label?.querySelector<HTMLElement>("button");
  if (!button) {
    throw new Error(`Missing toggle: ${labelText}`);
  }
  return button;
}

export function sampleModelPresets() {
  return [
    {
      preset_id: "11111111-1111-4111-8111-111111111111",
      preset_key: "gpt-4-1",
      display_name: "GPT-4.1",
      provider_key: "openai",
      model_id: "gpt-4.1",
      options: {},
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    },
    {
      preset_id: "22222222-2222-4222-8222-222222222222",
      preset_key: "gpt-4-1-mini",
      display_name: "GPT-4.1 Mini",
      provider_key: "openai",
      model_id: "gpt-4.1-mini",
      options: { reasoning_effort: "medium" as const },
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:00.000Z",
    },
  ];
}

export function sampleCapabilities(
  toolSelection: { bundle?: string; tier?: "default" | "advanced" } = {},
) {
  return {
    skills: {
      default_mode: "allow" as const,
      allow: [],
      deny: [],
      workspace_trusted: true,
      items: [
        { id: "review", name: "Review", version: "1.0.0", source: "bundled" as const },
        { id: "triage", name: "Triage", version: "1.0.0", source: "managed" as const },
      ],
    },
    mcp: {
      default_mode: "allow" as const,
      allow: [],
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
          source: "workspace" as const,
        },
      ],
    },
    tools: {
      ...toolSelection,
      default_mode: "allow" as const,
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
  };
}

export function sampleMcpExtensionDetails(): Record<string, ManagedExtensionDetail> {
  return {
    memory: {
      kind: "mcp",
      key: "memory",
      name: "Memory",
      description: null,
      version: null,
      enabled: true,
      revision: null,
      source: null,
      source_type: "builtin",
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
      default_mcp_server_settings_json: { enabled: true },
      default_mcp_server_settings_yaml: "enabled: true\n",
      sources: [],
    },
    filesystem: {
      kind: "mcp",
      key: "filesystem",
      name: "Filesystem",
      description: null,
      version: null,
      enabled: true,
      revision: 1,
      source: {
        kind: "npm",
        npm_spec: "@modelcontextprotocol/server-filesystem",
        command: "npx",
        args: ["-y"],
      },
      source_type: "managed",
      refreshable: true,
      materialized_path: "/tmp/managed/mcp/filesystem/server.yml",
      assignment_count: 0,
      transport: "stdio",
      default_access: "inherit",
      can_edit_settings: true,
      can_toggle_source_enabled: true,
      can_refresh_source: true,
      can_revert_source: true,
      manifest: null,
      spec: {
        id: "filesystem",
        name: "Filesystem",
        enabled: true,
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
      },
      files: [],
      revisions: [],
      default_mcp_server_settings_json: { namespace: "shared" },
      default_mcp_server_settings_yaml: "namespace: shared\n",
      sources: [],
    },
  };
}
