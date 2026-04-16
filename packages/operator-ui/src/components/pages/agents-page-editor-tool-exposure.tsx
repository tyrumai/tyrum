import type { AgentCapabilitiesResponse, ManagedAgentDetail } from "@tyrum/contracts";
import type { ReactElement } from "react";

type CanonicalToolExposureSource = "persisted" | "capabilities";

export type CanonicalToolExposureSelection = ManagedAgentDetail["tool_exposure"]["tools"];

type CanonicalToolExposure = CanonicalToolExposureSelection & {
  source: CanonicalToolExposureSource;
};

function hasCanonicalToolExposureSelection(selection: CanonicalToolExposureSelection): boolean {
  return Boolean(selection.bundle ?? selection.tier);
}

function readCapabilitiesToolExposureSelection(
  capabilities: AgentCapabilitiesResponse | null,
): CanonicalToolExposureSelection {
  const tools = capabilities?.tools;
  if (!tools || typeof tools !== "object") {
    return {};
  }

  const bundle = "bundle" in tools && typeof tools.bundle === "string" ? tools.bundle : undefined;
  const tier =
    "tier" in tools && (tools.tier === "default" || tools.tier === "advanced")
      ? tools.tier
      : undefined;

  return { bundle, tier };
}

export function resolveCanonicalToolExposure(input: {
  persistedToolExposure: CanonicalToolExposureSelection | null;
  capabilities: AgentCapabilitiesResponse | null;
}): CanonicalToolExposure | null {
  if (input.persistedToolExposure !== null) {
    if (!hasCanonicalToolExposureSelection(input.persistedToolExposure)) {
      return null;
    }
    return {
      ...input.persistedToolExposure,
      source: "persisted",
    };
  }

  const capabilitiesSelection = readCapabilitiesToolExposureSelection(input.capabilities);
  if (!hasCanonicalToolExposureSelection(capabilitiesSelection)) {
    return null;
  }

  return {
    ...capabilitiesSelection,
    source: "capabilities",
  };
}

function formatCanonicalToolTier(tier: CanonicalToolExposureSelection["tier"]): string {
  switch (tier) {
    case "advanced":
      return "Advanced";
    case "default":
      return "Default";
    default:
      return "Not set";
  }
}

function StaticExposureField({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}): ReactElement {
  return (
    <div className="grid gap-1">
      <div className="text-sm font-medium text-fg">{label}</div>
      <div
        className="rounded-lg border border-border/70 bg-bg-subtle/40 px-3 py-2 text-sm text-fg"
        data-testid={testId}
      >
        {value}
      </div>
    </div>
  );
}

export function CanonicalToolExposureSummary({
  exposure,
}: {
  exposure: CanonicalToolExposure;
}): ReactElement {
  const summaryLabel =
    exposure.source === "persisted" ? "Persisted canonical exposure" : "Default canonical exposure";
  const summaryDescription =
    exposure.source === "persisted"
      ? "Loaded from the saved agent detail."
      : "Derived from the current capabilities because this agent does not have a persisted detail record yet.";

  return (
    <div
      className="grid gap-3 rounded-lg border border-border/70 bg-bg-subtle/40 p-4"
      data-testid="agents-editor-tools-canonical-read-model"
    >
      <div className="grid gap-1">
        <div className="text-sm font-medium text-fg">{summaryLabel}</div>
        <div className="text-sm text-fg-muted">{summaryDescription}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <StaticExposureField
          label="Bundle"
          value={exposure.bundle ?? "Not set"}
          testId="agents-editor-tools-canonical-bundle"
        />
        <StaticExposureField
          label="Tier"
          value={formatCanonicalToolTier(exposure.tier)}
          testId="agents-editor-tools-canonical-tier"
        />
      </div>
    </div>
  );
}
