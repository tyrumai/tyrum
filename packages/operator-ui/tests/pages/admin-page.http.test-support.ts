import React, { act } from "react";
import { expect, vi } from "vitest";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import { cleanupTestRoot, renderIntoDocument, type TestRoot } from "../test-utils.js";
import {
  ADMIN_HTTP_EXECUTION_PROFILE_IDS,
  TEST_TIMESTAMP,
  createAdminHttpTestCore as createFixtureAdminHttpTestCore,
  createAssignmentsForAllProfiles,
  createAvailableModel,
  createModelAssignment,
  createModelPreset,
  createUnassignedAssignmentsForAllProfiles,
  type AvailableModelFixture,
  type ExecutionProfileId,
  type ModelAssignmentFixture,
  type ModelPresetFixture,
} from "./admin-page.http-fixture-support.js";

export {
  ADMIN_HTTP_EXECUTION_PROFILE_IDS,
  TEST_TIMESTAMP,
  createAssignmentsForAllProfiles,
  createAvailableModel,
  createModelAssignment,
  createModelPreset,
  createUnassignedAssignmentsForAllProfiles,
  type AvailableModelFixture,
  type ExecutionProfileId,
  type ModelAssignmentFixture,
  type ModelPresetFixture,
} from "./admin-page.http-fixture-support.js";

type ModelConfigMocks = {
  listPresets: ReturnType<typeof vi.fn>;
  listAvailable: ReturnType<typeof vi.fn>;
  listAssignments: ReturnType<typeof vi.fn>;
};

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function findLabeledElement<T extends Element>(
  root: ParentNode,
  selector: "input" | "select",
  labelPrefix: string,
): T | null {
  const label = Array.from(root.querySelectorAll<HTMLLabelElement>("label")).find((candidate) =>
    candidate.textContent?.trim().startsWith(labelPrefix),
  );
  return label?.htmlFor ? root.querySelector<T>(`${selector}[id="${label.htmlFor}"]`) : null;
}

export function expectPresent<T>(value: T | null | undefined): T {
  expect(value).not.toBeNull();
  return value as T;
}

export function getByTestId<T extends Element>(root: ParentNode, testId: string): T {
  return expectPresent(root.querySelector<T>(`[data-testid='${testId}']`));
}

export function getButton(root: ParentNode, text: string): HTMLButtonElement {
  return expectPresent(
    Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === text,
    ),
  );
}

export function getLabeledInput(root: ParentNode, labelPrefix: string): HTMLInputElement {
  return expectPresent(findLabeledElement<HTMLInputElement>(root, "input", labelPrefix));
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export function click(element: HTMLElement | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export async function clickAndFlush(element: HTMLElement | null | undefined): Promise<void> {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

export function setSelectValue(select: HTMLSelectElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set as
      | ((this: HTMLSelectElement, nextValue: string) => void)
      | undefined;
    setter?.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

export async function switchHttpTab(
  container: HTMLElement,
  tabTestId: string,
): Promise<HTMLButtonElement> {
  const button = expectPresent(
    container.querySelector<HTMLButtonElement>(`[data-testid="${tabTestId}"]`),
  );
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
  return button;
}

export async function openModelsTab(container: HTMLElement): Promise<void> {
  await switchHttpTab(container, "admin-http-tab-models");
  await flush();
}

export function openPolicyTab(container: HTMLElement): void {
  const trigger = expectPresent(
    container.querySelector<HTMLButtonElement>("[data-testid='admin-http-tab-policy']"),
  );
  act(() => {
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    trigger.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export function renderAdminHttpConfigurePage(core: OperatorCore): TestRoot {
  return renderIntoDocument(
    React.createElement(ElevatedModeProvider, { core, mode: "web" }, [
      React.createElement(ConfigurePage, { key: "page", core }),
    ]),
  );
}

export function cleanupAdminHttpPage(testRoot: TestRoot): void {
  cleanupTestRoot(testRoot);
}
export function getModelConfig(core: OperatorCore): ModelConfigMocks {
  return core.http.modelConfig as ModelConfigMocks;
}

export function setModelConfigResponses(
  core: OperatorCore,
  input: {
    presets?: ModelPresetFixture[];
    models?: AvailableModelFixture[];
    assignments?: ModelAssignmentFixture[];
    listAvailableError?: Error;
    listAssignmentsError?: Error;
  },
): ModelConfigMocks {
  const modelConfig = getModelConfig(core);
  modelConfig.listPresets = vi.fn(async () => ({
    status: "ok",
    presets: input.presets ?? [],
  }));
  modelConfig.listAvailable = vi.fn(async () => {
    if (input.listAvailableError) {
      throw input.listAvailableError;
    }
    return { status: "ok", models: input.models ?? [] };
  });
  modelConfig.listAssignments = vi.fn(async () => {
    if (input.listAssignmentsError) {
      throw input.listAssignmentsError;
    }
    return { status: "ok", assignments: input.assignments ?? [] };
  });
  return modelConfig;
}

export const createAdminHttpTestCore = createFixtureAdminHttpTestCore;
export function expectAuthorizedJsonRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  expected: { url: string; method?: string; body?: unknown },
): void {
  expect(getRequestUrl(input)).toBe(expected.url);
  expect(init?.method ?? "GET").toBe(expected.method ?? "GET");
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-elevated-token");
  if ("body" in expected) {
    expect(JSON.parse(String(init?.body ?? ""))).toEqual(expected.body);
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}
