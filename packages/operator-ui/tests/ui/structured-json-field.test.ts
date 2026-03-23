// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import * as operatorUi from "../../src/index.js";
import {
  cleanupTestRoot,
  renderIntoDocument,
  setNativeValue,
  setNativeSelectValue,
  setStructuredJsonObjectField,
} from "../test-utils.js";

describe("StructuredJsonField", () => {
  it("builds a structured object without raw JSON input", async () => {
    const StructuredJsonField = (operatorUi as Record<string, unknown>)["StructuredJsonField"];
    expect(StructuredJsonField).toBeDefined();

    const onJsonChange = vi.fn();
    const testRoot = renderIntoDocument(
      React.createElement(StructuredJsonField as React.ComponentType, {
        "data-testid": "editor",
        label: "Payload",
        value: undefined,
        onJsonChange,
      }),
    );

    await setStructuredJsonObjectField(testRoot.container, "editor", {
      key: "namespace",
      value: "shared",
    });

    const lastCall = onJsonChange.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual({ namespace: "shared" });
    expect(lastCall?.[1]).toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("reports duplicate object keys as validation errors", async () => {
    const StructuredJsonField = (operatorUi as Record<string, unknown>)["StructuredJsonField"];
    expect(StructuredJsonField).toBeDefined();

    const onJsonChange = vi.fn();
    const testRoot = renderIntoDocument(
      React.createElement(StructuredJsonField as React.ComponentType, {
        "data-testid": "editor",
        label: "Payload",
        value: undefined,
        onJsonChange,
      }),
    );

    await setStructuredJsonObjectField(testRoot.container, "editor", {
      key: "namespace",
      value: "shared",
    });

    const editor = testRoot.container.querySelector<HTMLElement>('[data-testid="editor"]');
    expect(editor).not.toBeNull();

    const addFieldButton = Array.from(editor?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.trim() === "Add field",
    );
    expect(addFieldButton).not.toBeNull();
    await act(async () => {
      addFieldButton?.click();
      await Promise.resolve();
    });

    const keyInputs = editor?.querySelectorAll<HTMLInputElement>('input[placeholder="field_name"]');
    const duplicateKeyInput = keyInputs?.item(1) ?? null;
    expect(duplicateKeyInput).not.toBeNull();
    if (duplicateKeyInput) {
      await act(async () => {
        setNativeValue(duplicateKeyInput, "namespace");
        await Promise.resolve();
      });
    }

    expect(testRoot.container.textContent).toContain("duplicate field");

    const lastCall = onJsonChange.mock.calls.at(-1);
    expect(lastCall?.[0]).toBeUndefined();
    expect(String(lastCall?.[1] ?? "")).toContain("duplicate field");

    cleanupTestRoot(testRoot);
  });

  it("renders schema-backed fields and emits typed values", async () => {
    const StructuredJsonField = (operatorUi as Record<string, unknown>)["StructuredJsonField"];
    expect(StructuredJsonField).toBeDefined();

    const onJsonChange = vi.fn();
    const testRoot = renderIntoDocument(
      React.createElement(StructuredJsonField as React.ComponentType, {
        label: "Budgets",
        schema: {
          type: "object",
          properties: {
            max_total_tokens: {
              type: "integer",
              title: "Max total tokens",
              minimum: 0,
            },
          },
        },
        value: undefined,
        onJsonChange,
      }),
    );

    const input = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="structured-json-schema-field-root-max_total_tokens"]',
    );
    expect(input).toBeInstanceOf(HTMLInputElement);
    if (input) {
      await act(async () => {
        setNativeValue(input, "42");
        await Promise.resolve();
      });
    }

    const lastCall = onJsonChange.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual({ max_total_tokens: 42 });
    expect(lastCall?.[1]).toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("supports schema-backed arrays and additional fields", async () => {
    const StructuredJsonField = (operatorUi as Record<string, unknown>)["StructuredJsonField"];
    expect(StructuredJsonField).toBeDefined();

    const onJsonChange = vi.fn();
    const testRoot = renderIntoDocument(
      React.createElement(StructuredJsonField as React.ComponentType, {
        label: "Fingerprint",
        schema: {
          type: "object",
          additionalProperties: true,
          properties: {
            resources: {
              type: "array",
              title: "Resources",
              items: {
                type: "string",
                title: "Resource",
              },
            },
          },
        },
        value: undefined,
        onJsonChange,
      }),
    );

    const addResourceButton = Array.from(testRoot.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Add resource",
    );
    expect(addResourceButton).not.toBeNull();
    await act(async () => {
      addResourceButton?.click();
      await Promise.resolve();
    });

    const resourceInput = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="structured-json-schema-field-root-resources-0"]',
    );
    expect(resourceInput).toBeInstanceOf(HTMLInputElement);
    if (resourceInput) {
      await act(async () => {
        setNativeValue(resourceInput, "workspace://repo/main");
        await Promise.resolve();
      });
    }

    const addObjectButton = Array.from(testRoot.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Add object",
    );
    expect(addObjectButton).not.toBeNull();
    await act(async () => {
      addObjectButton?.click();
      await Promise.resolve();
    });

    const addFieldButton = Array.from(testRoot.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Add field",
    );
    expect(addFieldButton).not.toBeNull();
    await act(async () => {
      addFieldButton?.click();
      await Promise.resolve();
    });

    const keyInput = testRoot.container.querySelector<HTMLInputElement>(
      'input[placeholder="field_name"]',
    );
    expect(keyInput).toBeInstanceOf(HTMLInputElement);
    if (keyInput) {
      await act(async () => {
        setNativeValue(keyInput, "scope");
        await Promise.resolve();
      });
    }

    const extraValueInput = testRoot.container.querySelector<HTMLTextAreaElement>("textarea");
    expect(extraValueInput).toBeInstanceOf(HTMLTextAreaElement);
    if (extraValueInput) {
      await act(async () => {
        setNativeValue(extraValueInput, "shared");
        await Promise.resolve();
      });
    }

    const lastCall = onJsonChange.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual({
      resources: ["workspace://repo/main"],
      scope: "shared",
    });
    expect(lastCall?.[1]).toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("builds a structured list without raw JSON input", async () => {
    const StructuredJsonField = (operatorUi as Record<string, unknown>)["StructuredJsonField"];
    expect(StructuredJsonField).toBeDefined();

    const onJsonChange = vi.fn();
    const testRoot = renderIntoDocument(
      React.createElement(StructuredJsonField as React.ComponentType, {
        "data-testid": "editor",
        label: "Items",
        value: undefined,
        onJsonChange,
      }),
    );

    const addListButton = Array.from(testRoot.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Add list",
    );
    expect(addListButton).not.toBeNull();
    await act(async () => {
      addListButton?.click();
      await Promise.resolve();
    });

    const addItemButton = Array.from(testRoot.container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Add item",
    );
    expect(addItemButton).not.toBeNull();
    await act(async () => {
      addItemButton?.click();
      await Promise.resolve();
    });

    const selects = Array.from(testRoot.container.querySelectorAll<HTMLSelectElement>("select"));
    const itemTypeSelect = selects.at(-1);
    expect(itemTypeSelect).toBeInstanceOf(HTMLSelectElement);
    if (itemTypeSelect) {
      await act(async () => {
        setNativeSelectValue(itemTypeSelect, "number");
        await Promise.resolve();
      });
    }

    const numberInput = testRoot.container.querySelector<HTMLInputElement>('input[type="number"]');
    expect(numberInput).toBeInstanceOf(HTMLInputElement);
    if (numberInput) {
      await act(async () => {
        setNativeValue(numberInput, "7");
        await Promise.resolve();
      });
    }

    const lastCall = onJsonChange.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual([7]);
    expect(lastCall?.[1]).toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("disables tree editing in read-only mode", () => {
    const StructuredJsonField = (operatorUi as Record<string, unknown>)["StructuredJsonField"];
    expect(StructuredJsonField).toBeDefined();

    const testRoot = renderIntoDocument(
      React.createElement(StructuredJsonField as React.ComponentType, {
        "data-testid": "editor",
        label: "Payload",
        readOnly: true,
        value: { namespace: "shared" },
      }),
    );

    expect(testRoot.container.textContent).not.toContain("Add field");
    expect(testRoot.container.textContent).not.toContain("Clear value");

    const keyInput = testRoot.container.querySelector<HTMLInputElement>(
      'input[placeholder="field_name"]',
    );
    expect(keyInput?.readOnly).toBe(true);

    cleanupTestRoot(testRoot);
  });
});
