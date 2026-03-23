// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { ChannelFieldSections } from "../../src/components/pages/admin-http-channels-dialog-fields.js";
import {
  buildInitialFormState,
  loadAgentOptions,
  type ChannelFieldErrors,
  type ChannelFormState,
  type ChannelRegistryEntry,
} from "../../src/components/pages/admin-http-channels-shared.js";
import {
  cleanupTestRoot,
  renderIntoDocument,
  setNativeValue,
  setStructuredJsonObjectField,
} from "../test-utils.js";
import { createAdminHttpTestCore } from "./admin-page.http-fixture-support.js";

describe("admin http channels validation", () => {
  it("keeps text config defaults string-only when registry metadata is mis-typed", async () => {
    const { core } = createAdminHttpTestCore();
    const agentOptions = await loadAgentOptions(core.admin);
    const entry: ChannelRegistryEntry = {
      channel: "discord",
      name: "Discord",
      doc: null,
      supported: true,
      configurable: true,
      intro_title: null,
      intro_lines: [],
      fields: [
        {
          key: "audience",
          label: "Audience",
          description: null,
          kind: "config",
          input: "text",
          section: "credentials",
          required: false,
          default_value: true,
          placeholder: null,
          help_title: null,
          help_lines: [],
          options: [],
          option_source: null,
          visible_when: null,
        },
      ],
    };

    const initialState = buildInitialFormState({
      entry,
      account: null,
      agentOptions,
    });

    expect(initialState.configValues["audience"]).toBe("");
  });

  it("keeps the last valid config JSON value while surfacing local editor errors", async () => {
    const { core } = createAdminHttpTestCore();
    const agentOptions = await loadAgentOptions(core.admin);
    const entry: ChannelRegistryEntry = {
      channel: "discord",
      name: "Discord",
      doc: null,
      supported: true,
      configurable: true,
      intro_title: null,
      intro_lines: [],
      fields: [
        {
          key: "settings",
          label: "Settings",
          description: "Structured settings",
          kind: "config",
          input: "json",
          section: "advanced",
          required: false,
          default_value: null,
          placeholder: null,
          help_title: null,
          help_lines: [],
          options: [],
          option_source: null,
          visible_when: null,
        },
      ],
    };

    function Harness(): React.ReactElement {
      const [state, setState] = React.useState<ChannelFormState>(
        buildInitialFormState({
          entry,
          account: null,
          agentOptions,
        }),
      );
      const [fieldErrors, setFieldErrors] = React.useState<ChannelFieldErrors>({});
      const fieldErrorText = (fieldKey: string) => {
        const messages = fieldErrors[fieldKey];
        return messages && messages.length > 0 ? messages.join(" ") : null;
      };

      return React.createElement(
        "div",
        null,
        React.createElement(ChannelFieldSections, {
          entry,
          state,
          account: null,
          agentOptions,
          fieldErrorText,
          setState,
          setFieldErrors,
        }),
        React.createElement("pre", { "data-testid": "state" }, JSON.stringify(state)),
        React.createElement("pre", { "data-testid": "errors" }, JSON.stringify(fieldErrors)),
      );
    }

    const testRoot = renderIntoDocument(React.createElement(Harness));

    await setStructuredJsonObjectField(testRoot.container, "channels-account-field-settings", {
      key: "namespace",
      value: "shared",
    });

    expect(testRoot.container.querySelector("[data-testid='state']")?.textContent).toContain(
      '"settings":{"namespace":"shared"}',
    );

    const initialEditor = testRoot.container.querySelector<HTMLElement>(
      "[data-testid='channels-account-field-settings']",
    );
    expect(initialEditor).not.toBeNull();

    const addFieldButton = Array.from(initialEditor?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.trim() === "Add field",
    );
    expect(addFieldButton).not.toBeNull();
    await act(async () => {
      addFieldButton?.click();
      await Promise.resolve();
    });

    const editor = testRoot.container.querySelector<HTMLElement>(
      "[data-testid='channels-account-field-settings']",
    );
    const keyInputs = editor?.querySelectorAll<HTMLInputElement>('input[placeholder="field_name"]');
    const duplicateKeyInput = keyInputs?.item(1) ?? null;
    expect(duplicateKeyInput).not.toBeNull();
    if (duplicateKeyInput) {
      await act(async () => {
        setNativeValue(duplicateKeyInput, "namespace");
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    const stateText = String(
      testRoot.container.querySelector("[data-testid='state']")?.textContent ?? "",
    );
    expect(stateText).toContain('"settings":{');
    expect(stateText).toContain('"namespace":"shared"');
    expect(stateText).toContain('"field_2":""');
    expect(testRoot.container.querySelector("[data-testid='errors']")?.textContent).toContain(
      "duplicate field",
    );

    cleanupTestRoot(testRoot);
  });
});
