import type { AgentCapabilitiesResponse, ManagedAgentDetail } from "@tyrum/contracts";
import type { ReactElement } from "react";
import { Select } from "../ui/select.js";

export type CanonicalToolExposureSelection = ManagedAgentDetail["tool_exposure"]["tools"];

const DEFAULT_TOOL_BUNDLE = "authoring-core";
const WORKSPACE_DEFAULT_TOOL_BUNDLE = "workspace-default";

function appendUniqueOption(options: string[], value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed || options.includes(trimmed)) {
    return;
  }
  options.push(trimmed);
}

function readCapabilitiesBundle(
  capabilities: AgentCapabilitiesResponse | null,
): string | undefined {
  const tools = capabilities?.tools;
  if (!tools || typeof tools !== "object") {
    return undefined;
  }
  const bundle = "bundle" in tools && typeof tools.bundle === "string" ? tools.bundle : undefined;
  return bundle?.trim() ? bundle.trim() : undefined;
}

function listCanonicalToolBundleOptions(input: {
  capabilities: AgentCapabilitiesResponse | null;
  selectedBundle: string;
}): string[] {
  const options: string[] = [];
  appendUniqueOption(options, input.selectedBundle);
  appendUniqueOption(options, readCapabilitiesBundle(input.capabilities));
  appendUniqueOption(options, DEFAULT_TOOL_BUNDLE);
  appendUniqueOption(options, WORKSPACE_DEFAULT_TOOL_BUNDLE);
  return options;
}

export function CanonicalToolExposureFields({
  capabilities,
  helperText,
  onBundleChange,
  onTierChange,
  selection,
}: {
  capabilities: AgentCapabilitiesResponse | null;
  helperText: string;
  onBundleChange: (bundle: string) => void;
  onTierChange: (tier: "" | "default" | "advanced") => void;
  selection: {
    bundle: string;
    tier: "" | "default" | "advanced";
  };
}): ReactElement {
  const bundleOptions = listCanonicalToolBundleOptions({
    capabilities,
    selectedBundle: selection.bundle,
  });

  return (
    <div
      className="grid gap-3 rounded-lg border border-border/70 bg-bg-subtle/40 p-4"
      data-testid="agents-editor-tools-canonical-controls"
    >
      <div className="grid gap-1">
        <div className="text-sm font-medium text-fg">Canonical tool exposure</div>
        <div className="text-sm text-fg-muted">{helperText}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          data-testid="agents-editor-tools-canonical-bundle"
          label="Bundle"
          value={selection.bundle}
          onChange={(event) => {
            onBundleChange(event.currentTarget.value);
          }}
        >
          <option value="">Not set</option>
          {bundleOptions.map((bundle) => (
            <option key={bundle} value={bundle}>
              {bundle}
            </option>
          ))}
        </Select>
        <Select
          data-testid="agents-editor-tools-canonical-tier"
          label="Tier"
          value={selection.tier}
          onChange={(event) => {
            const value = event.currentTarget.value;
            onTierChange(value === "default" || value === "advanced" ? value : "");
          }}
        >
          <option value="">Not set</option>
          <option value="default">Default</option>
          <option value="advanced">Advanced</option>
        </Select>
      </div>
    </div>
  );
}
