// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { AgentEditorSections } from "../../src/components/pages/agents-page-editor-sections.js";
import { createBlankForm } from "../../src/components/pages/agents-page-editor-form.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
import {
  sampleCapabilities,
  sampleMcpExtensionDetails,
  sampleModelPresets,
} from "./agents-page-editor-sections.test-support.js";

function renderToolExposureSection(props: {
  mode: "create" | "edit";
  capabilities: ReturnType<typeof sampleCapabilities>;
  persistedToolExposure: Record<string, unknown> | null;
}) {
  return renderIntoDocument(
    React.createElement(AgentEditorSections, {
      form: {
        ...createBlankForm(),
        memorySettingsMode: "override",
      },
      mode: props.mode,
      setField: vi.fn(),
      modelPresets: sampleModelPresets(),
      capabilities: props.capabilities,
      persistedToolExposure: props.persistedToolExposure,
      capabilitiesLoading: false,
      capabilitiesError: null,
      modelPresetsLoading: false,
      modelPresetsError: null,
      selectedPrimaryPreset: null,
      legacyPrimarySelection: null,
      onSelectPrimaryPreset: vi.fn(),
      onClearPrimaryModel: vi.fn(),
      unsupportedModelOptions: null,
      preservedModelOptionsRaw: {},
      mcpExtensionDetailsById: sampleMcpExtensionDetails(),
      mcpExplicitServerSettings: {},
      mcpExtensionsLoading: false,
      mcpExtensionsError: null,
      onMemorySettingsModeChange: vi.fn(),
      mcpSettingsDrafts: {},
      onMcpSettingsDraftChange: vi.fn(),
    }),
  );
}

describe("AgentEditorSections canonical tool exposure", () => {
  it("renders canonical tool exposure from capabilities in create mode", () => {
    const { root, container } = renderToolExposureSection({
      mode: "create",
      capabilities: sampleCapabilities({
        bundle: "authoring-core",
        tier: "default",
      }),
      persistedToolExposure: null,
    });

    expect(container.textContent).toContain("Default canonical exposure");
    expect(
      container.querySelector('[data-testid="agents-editor-tools-canonical-bundle"]')?.textContent,
    ).toBe("authoring-core");
    expect(
      container.querySelector('[data-testid="agents-editor-tools-canonical-tier"]')?.textContent,
    ).toBe("Default");
    expect(container.textContent).toContain("Legacy compatibility controls");

    cleanupTestRoot({ root, container });
  });

  it("falls back to legacy tool exposure messaging when canonical selectors are unavailable", () => {
    const { root, container } = renderToolExposureSection({
      mode: "edit",
      capabilities: sampleCapabilities(),
      persistedToolExposure: {},
    });

    expect(container.textContent).toContain("Legacy tool exposure");
    expect(container.textContent).toContain(
      "Canonical bundle and tier selectors are not available for this record yet.",
    );
    expect(
      container.querySelector('[data-testid="agents-editor-tools-canonical-read-model"]'),
    ).toBe(null);

    cleanupTestRoot({ root, container });
  });
});
