// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { AgentEditorSections } from "../../src/components/pages/agents-page-editor-sections.js";
import { createBlankForm } from "../../src/components/pages/agents-page-editor-form.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";
import {
  findLabeledControl,
  sampleCapabilities,
  sampleMcpExtensionDetails,
  sampleModelPresets,
  setLabeledValue,
} from "./agents-page-editor-sections.test-support.js";

function renderToolExposureSection(props: {
  mode: "create" | "edit";
  capabilities: ReturnType<typeof sampleCapabilities>;
  formOverrides?: Partial<ReturnType<typeof createBlankForm>>;
}) {
  const setField = vi.fn();
  return renderIntoDocument(
    React.createElement(AgentEditorSections, {
      form: {
        ...createBlankForm(),
        memorySettingsMode: "override",
        ...props.formOverrides,
      },
      mode: props.mode,
      setField,
      modelPresets: sampleModelPresets(),
      capabilities: props.capabilities,
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
  it("renders editable canonical tool exposure controls in create mode", () => {
    const { root, container } = renderToolExposureSection({
      mode: "create",
      capabilities: sampleCapabilities({
        bundle: "authoring-core",
        tier: "default",
      }),
    });

    const bundleSelect = container.querySelector<HTMLSelectElement>(
      '[data-testid="agents-editor-tools-canonical-bundle"]',
    );
    expect(container.textContent).toContain("Canonical tool exposure");
    expect(bundleSelect?.value).toBe("authoring-core");
    expect(Array.from(bundleSelect?.options ?? []).map((option) => option.value)).toContain(
      "workspace-default",
    );
    expect(
      container.querySelector<HTMLSelectElement>(
        '[data-testid="agents-editor-tools-canonical-tier"]',
      )?.value,
    ).toBe("default");
    expect(container.textContent).toContain("Legacy compatibility controls");

    cleanupTestRoot({ root, container });
  });

  it("keeps canonical controls editable when the current edit record has no canonical selection", () => {
    const { root, container } = renderToolExposureSection({
      mode: "edit",
      capabilities: sampleCapabilities(),
      formOverrides: {
        toolsBundle: "",
        toolsTier: "",
      },
    });

    expect(container.textContent).toContain(
      "Choose the canonical bundle and tier that should be saved for this agent.",
    );
    expect(findLabeledControl(container, "Bundle")).toBeInstanceOf(HTMLSelectElement);
    expect(findLabeledControl(container, "Tier")).toBeInstanceOf(HTMLSelectElement);

    cleanupTestRoot({ root, container });
  });

  it("wires bundle and tier changes into the form state", () => {
    const setField = vi.fn();
    const { root, container } = renderIntoDocument(
      React.createElement(AgentEditorSections, {
        form: {
          ...createBlankForm(),
          memorySettingsMode: "override",
        },
        mode: "edit",
        setField,
        modelPresets: sampleModelPresets(),
        capabilities: sampleCapabilities(),
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

    setLabeledValue(container, "Bundle", "workspace-default");
    setLabeledValue(container, "Tier", "advanced");

    expect(setField).toHaveBeenCalledWith("toolsBundle", "workspace-default");
    expect(setField).toHaveBeenCalledWith("toolsTier", "advanced");

    cleanupTestRoot({ root, container });
  });
});
