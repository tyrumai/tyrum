// @vitest-environment jsdom

import { PERSONA_TONE_PRESETS } from "@tyrum/contracts";
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentEditorSections } from "../../src/components/pages/agents-page-editor-sections.js";
import { createBlankForm } from "../../src/components/pages/agents-page-editor-form.js";
import { cleanupTestRoot, click, renderIntoDocument } from "../test-utils.js";
import {
  findLabeledControl,
  findToggle,
  sampleCapabilities,
  sampleMcpExtensionDetails,
  sampleModelPresets,
  setLabeledValue,
  setMultiSelectValues,
} from "./agents-page-editor-sections.test-support.js";

describe("AgentEditorSections", () => {
  it(
    "wires profile, runtime, conversation, and memory controls into setField",
    { timeout: 15_000 },
    () => {
      const setField = vi.fn();

      function Harness() {
        const [form, setForm] = React.useState({
          ...createBlankForm(),
          memorySettingsMode: "override" as const,
        });
        return React.createElement(AgentEditorSections, {
          form,
          mode: "create",
          setField: (key, value) => {
            setField(key, value);
            setForm((current) => ({ ...current, [key]: value }));
          },
          modelPresets: sampleModelPresets(),
          capabilities: sampleCapabilities(),
          capabilitiesLoading: false,
          capabilitiesError: null,
          modelPresetsLoading: false,
          modelPresetsError: null,
          selectedPrimaryPreset: null,
          legacyPrimarySelection: null,
          onSelectPrimaryPreset: (preset) => {
            setField("model", `${preset.provider_key}/${preset.model_id}`);
            setForm((current) => ({
              ...current,
              model: `${preset.provider_key}/${preset.model_id}`,
            }));
          },
          onClearPrimaryModel: () => {
            setField("model", "");
            setForm((current) => ({ ...current, model: "" }));
          },
          unsupportedModelOptions: '{\n  "temperature": 0.2\n}',
          preservedModelOptionsRaw: { temperature: 0.2 },
          mcpExtensionDetailsById: sampleMcpExtensionDetails(),
          mcpExplicitServerSettings: {},
          mcpExtensionsLoading: false,
          mcpExtensionsError: null,
          onMemorySettingsModeChange: (modeValue) => {
            setField("memorySettingsMode", modeValue);
            setForm((current) => ({ ...current, memorySettingsMode: modeValue }));
          },
          mcpSettingsDrafts: {},
          onMcpSettingsDraftChange: vi.fn(),
        });
      }

      const { root, container } = renderIntoDocument(React.createElement(Harness));

      const inputUpdates = [
        ["Agent key", "agent-review"],
        ["Name", "Agent Review"],
        ["Variant", "fast"],
        ["TTL days", "45"],
        ["Max turns", "18"],
        ["Context max messages", "64"],
        ["Tool prune keep", "6"],
        ["Consecutive repeat limit", "4"],
        ["Cycle repeat limit", "5"],
        ["Window assistant messages", "6"],
        ["Similarity threshold", "0.99"],
        ["Minimum chars", "180"],
        ["Cooldown assistant messages", "8"],
        ["Keyword limit", "9"],
        ["Semantic limit", "11"],
        ["Total budget items", "100"],
        ["Total budget chars", "1000"],
        ["Total budget tokens", "2000"],
        ["Fact budget items", "10"],
        ["Fact budget chars", "110"],
        ["Fact budget tokens", "210"],
        ["Note budget items", "11"],
        ["Note budget chars", "111"],
        ["Note budget tokens", "211"],
        ["Procedure budget items", "12"],
        ["Procedure budget chars", "112"],
        ["Procedure budget tokens", "212"],
        ["Episode budget items", "13"],
        ["Episode budget chars", "113"],
        ["Episode budget tokens", "213"],
      ] as const;

      for (const [label, value] of inputUpdates) {
        act(() => {
          setLabeledValue(container, label, value);
        });
      }

      const textAreaUpdates = [
        [
          "Tone instructions",
          "Be measured and careful. Prefer short paragraphs and be explicit about uncertainty.",
        ],
        ["Structured fact keys", "owner\nrepo"],
        ["Structured tags", "ops\nui"],
      ] as const;

      for (const [label, value] of textAreaUpdates) {
        act(() => {
          setLabeledValue(container, label, value);
        });
      }

      const steadyTonePreset = container.querySelector<HTMLElement>(
        '[data-testid="agents-editor-tone-preset-steady"]',
      );
      expect(steadyTonePreset).not.toBeNull();
      act(() => {
        click(steadyTonePreset!);
      });

      act(() => {
        setLabeledValue(container, "Default for new skills", "deny");
        setLabeledValue(container, "Default for new MCP servers", "deny");
        setLabeledValue(container, "Default for new tools", "deny");
      });

      const accessLists = Array.from(container.querySelectorAll("select[multiple]"));
      expect(accessLists).toHaveLength(6);
      const moveToAllowButtons = Array.from(container.querySelectorAll("button")).filter(
        (element) => element.textContent?.trim() === "Move to allow",
      );
      expect(moveToAllowButtons).toHaveLength(3);

      act(() => {
        setMultiSelectValues(accessLists[0] as HTMLSelectElement, ["review"]);
        click(moveToAllowButtons[0] as HTMLElement);
        setMultiSelectValues(accessLists[2] as HTMLSelectElement, ["filesystem"]);
        click(moveToAllowButtons[1] as HTMLElement);
        setMultiSelectValues(accessLists[4] as HTMLSelectElement, ["read"]);
        click(moveToAllowButtons[2] as HTMLElement);
      });

      const primaryToggle = container.querySelector<HTMLElement>(
        '[data-testid="agents-editor-primary-model-toggle"]',
      );
      expect(primaryToggle).not.toBeNull();
      act(() => {
        if (primaryToggle) click(primaryToggle);
      });

      act(() => {
        setLabeledValue(container, "Filter configured models", "mini");
      });

      const primaryOption = container.querySelector<HTMLElement>(
        '[data-testid="agents-editor-primary-model-option-gpt-4-1-mini"]',
      );
      expect(primaryOption).not.toBeNull();
      act(() => {
        if (primaryOption) click(primaryOption);
      });

      const fallbackToggle = container.querySelector<HTMLElement>(
        '[data-testid="agents-editor-fallbacks-toggle"]',
      );
      expect(fallbackToggle).not.toBeNull();
      act(() => {
        if (fallbackToggle) click(fallbackToggle);
      });

      const firstFallbackOption = container.querySelector<HTMLElement>(
        '[data-testid="agents-editor-fallback-option-openai/gpt-4.1"]',
      );
      expect(firstFallbackOption).not.toBeNull();
      act(() => {
        if (firstFallbackOption) click(firstFallbackOption);
      });

      act(() => {
        if (fallbackToggle) click(fallbackToggle);
      });

      const secondFallbackOption = container.querySelector<HTMLElement>(
        '[data-testid="agents-editor-fallback-option-openai/gpt-4.1-mini"]',
      );
      expect(secondFallbackOption).not.toBeNull();
      act(() => {
        if (secondFallbackOption) click(secondFallbackOption);
      });

      const toggleLabels = [
        "Trust workspace skills",
        "Enable within-turn loop detection",
        "Enable cross-turn loop detection",
        "Enable memory",
        "Public",
        "Private",
        "Sensitive",
        "Enable keyword retrieval",
        "Enable semantic retrieval",
      ] as const;

      for (const label of toggleLabels) {
        act(() => {
          click(findToggle(container, label));
        });
      }

      const calls = setField.mock.calls as Array<[string, unknown]>;
      expect(calls).toContainEqual(["agentKey", "agent-review"]);
      expect(calls).toContainEqual(["name", "Agent Review"]);
      expect(calls).toContainEqual([
        "tone",
        "Be measured and careful. Prefer short paragraphs and be explicit about uncertainty.",
      ]);
      expect(calls).toContainEqual([
        "tone",
        PERSONA_TONE_PRESETS.find((preset) => preset.key === "steady")?.instructions,
      ]);
      expect(calls).toContainEqual(["model", "openai/gpt-4.1-mini"]);
      expect(calls).toContainEqual(["fallbacks", "openai/gpt-4.1"]);
      expect(calls).toContainEqual(["fallbacks", "openai/gpt-4.1\nopenai/gpt-4.1-mini"]);
      expect(calls).toContainEqual(["skillsDefaultMode", "deny"]);
      expect(calls).toContainEqual(["skillsAllow", ["review"]]);
      expect(calls).toContainEqual(["mcpDefaultMode", "deny"]);
      expect(calls).toContainEqual(["mcpAllow", ["filesystem"]]);
      expect(calls).toContainEqual(["toolsDefaultMode", "deny"]);
      expect(calls).toContainEqual(["toolsAllow", ["read"]]);
      expect(calls).toContainEqual(["ttlDays", "45"]);
      expect(calls).toContainEqual(["withinTurnConsecutiveLimit", "4"]);
      expect(calls).toContainEqual(["crossTurnSimilarityThreshold", "0.99"]);
      expect(calls).toContainEqual(["factKeys", "owner\nrepo"]);
      expect(calls).toContainEqual(["memoryTags", "ops\nui"]);
      expect(calls).toContainEqual(["semanticLimit", "11"]);
      expect(calls).toContainEqual(["episodeTokens", "213"]);
      expect(
        calls.some(
          ([key, value]) => key === "workspaceSkillsTrusted" && typeof value === "boolean",
        ),
      ).toBe(true);
      expect(
        calls.some(([key, value]) => key === "withinTurnEnabled" && typeof value === "boolean"),
      ).toBe(true);
      expect(
        calls.some(([key, value]) => key === "crossTurnEnabled" && typeof value === "boolean"),
      ).toBe(true);
      expect(
        calls.some(([key, value]) => key === "memoryEnabled" && typeof value === "boolean"),
      ).toBe(true);
      expect(
        calls.some(([key, value]) => key === "allowSensitive" && typeof value === "boolean"),
      ).toBe(true);
      expect(
        calls.some(([key, value]) => key === "keywordEnabled" && typeof value === "boolean"),
      ).toBe(true);
      expect(
        calls.some(([key, value]) => key === "semanticEnabled" && typeof value === "boolean"),
      ).toBe(true);

      // Existing model options renders as a StructuredValue (read-only text), not a form control.
      expect(container.textContent).toContain("Existing model options");
      expect(container.textContent).toContain("Temperature");

      cleanupTestRoot({ root, container });
    },
  );

  it("disables the agent key outside create mode", () => {
    const form = createBlankForm();
    const setField = vi.fn();

    const { root, container } = renderIntoDocument(
      React.createElement(AgentEditorSections, {
        form: {
          ...form,
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

    expect(findLabeledControl(container, "Agent key").hasAttribute("disabled")).toBe(true);
    expect(container.textContent).not.toContain("Existing model options");

    cleanupTestRoot({ root, container });
  });
});
