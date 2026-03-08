// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { AgentEditorSections } from "../../src/components/pages/agents-page-editor-sections.js";
import { createBlankForm } from "../../src/components/pages/agents-page-editor-form.js";
import { cleanupTestRoot, click, renderIntoDocument, setNativeValue } from "../test-utils.js";

function findLabeledControl(
  container: HTMLElement,
  labelText: string,
): HTMLInputElement | HTMLTextAreaElement {
  const label = Array.from(container.querySelectorAll("label")).find(
    (element) => element.textContent?.trim() === labelText,
  );
  if (!(label instanceof HTMLLabelElement) || !label.htmlFor) {
    throw new Error(`Missing label: ${labelText}`);
  }
  const control = container.ownerDocument.getElementById(label.htmlFor);
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) {
    throw new Error(`Missing control for label: ${labelText}`);
  }
  return control;
}

function findToggle(container: HTMLElement, labelText: string): HTMLElement {
  const label = Array.from(container.querySelectorAll("label")).find((element) => {
    return element.textContent?.replace(/\s+/gu, " ").trim() === labelText;
  });
  const button = label?.querySelector<HTMLElement>("button");
  if (!button) {
    throw new Error(`Missing toggle: ${labelText}`);
  }
  return button;
}

describe("AgentEditorSections", () => {
  it("wires profile, runtime, session, and memory controls into setField", () => {
    const form = createBlankForm();
    const setField = vi.fn();

    const { root, container } = renderIntoDocument(
      React.createElement(AgentEditorSections, {
        form,
        mode: "create",
        setField,
        unsupportedModelOptions: '{\n  "temperature": 0.2\n}',
      }),
    );

    const inputUpdates = [
      ["Agent key", "agent-review"],
      ["Name", "Agent Review"],
      ["Tone", "measured"],
      ["Palette", "ember"],
      ["Character", "analyst"],
      ["Emoji", "R"],
      ["Verbosity", "low"],
      ["Format", "markdown"],
      ["Primary model", "openai/gpt-4.1-mini"],
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
        setNativeValue(findLabeledControl(container, label), value);
      });
    }

    const textAreaUpdates = [
      ["Description", "Managed reviewer"],
      ["Identity body", "Be concise and rigorous."],
      ["Fallback models", "openai/gpt-4.1\nopenai/gpt-4.1-mini"],
      ["Enabled skills", "review\ntriage"],
      ["Enabled MCP servers", "filesystem"],
      ["Allowed tools", "shell.read"],
      ["Structured fact keys", "owner\nrepo"],
      ["Structured tags", "ops\nui"],
    ] as const;

    for (const [label, value] of textAreaUpdates) {
      act(() => {
        setNativeValue(findLabeledControl(container, label), value);
      });
    }

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
    expect(calls).toContainEqual(["description", "Managed reviewer"]);
    expect(calls).toContainEqual(["identityBody", "Be concise and rigorous."]);
    expect(calls).toContainEqual(["model", "openai/gpt-4.1-mini"]);
    expect(calls).toContainEqual(["fallbacks", "openai/gpt-4.1\nopenai/gpt-4.1-mini"]);
    expect(calls).toContainEqual(["skillsEnabled", "review\ntriage"]);
    expect(calls).toContainEqual(["mcpEnabled", "filesystem"]);
    expect(calls).toContainEqual(["toolsAllowed", "shell.read"]);
    expect(calls).toContainEqual(["ttlDays", "45"]);
    expect(calls).toContainEqual(["withinTurnConsecutiveLimit", "4"]);
    expect(calls).toContainEqual(["crossTurnSimilarityThreshold", "0.99"]);
    expect(calls).toContainEqual(["factKeys", "owner\nrepo"]);
    expect(calls).toContainEqual(["memoryTags", "ops\nui"]);
    expect(calls).toContainEqual(["semanticLimit", "11"]);
    expect(calls).toContainEqual(["episodeTokens", "213"]);
    expect(
      calls.some(([key, value]) => key === "workspaceSkillsTrusted" && typeof value === "boolean"),
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

    const unsupportedOptions = findLabeledControl(container, "Existing model options");
    expect(unsupportedOptions.hasAttribute("readonly")).toBe(true);

    cleanupTestRoot({ root, container });
  });

  it("disables the agent key outside create mode", () => {
    const form = createBlankForm();
    const setField = vi.fn();

    const { root, container } = renderIntoDocument(
      React.createElement(AgentEditorSections, {
        form,
        mode: "edit",
        setField,
        unsupportedModelOptions: null,
      }),
    );

    expect(findLabeledControl(container, "Agent key").hasAttribute("disabled")).toBe(true);
    expect(container.textContent).not.toContain("Existing model options");

    cleanupTestRoot({ root, container });
  });
});
