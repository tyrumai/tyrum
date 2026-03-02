// @vitest-environment jsdom

import type { OperatorCore } from "@tyrum/operator-core";
import { createAdminModeStore } from "../../operator-core/src/index.js";
import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { AdminModeProvider } from "../src/admin-mode.js";
import { AdminHttpPanels } from "../src/components/admin-http/admin-http-panels.js";
import { cleanupTestRoot, renderIntoDocument } from "./test-utils.js";

function setInputValue(input: HTMLInputElement, value: string): void {
  const { set: nativeSetter } =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") ?? {};
  if (typeof nativeSetter !== "function") {
    throw new Error("Unable to resolve the native input value setter");
  }

  nativeSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function createStubCore(partialHttp: Partial<OperatorCore["http"]>): OperatorCore {
  const adminModeStore = createAdminModeStore({
    tickIntervalMs: 0,
    now: () => Date.parse("2026-03-02T00:00:00.000Z"),
  });
  adminModeStore.enter({
    elevatedToken: "elevated-test-token",
    expiresAt: "2026-03-02T00:10:00.000Z",
  });

  return {
    httpBaseUrl: "http://example.test",
    adminModeStore,
    http: {
      audit: { exportReceiptBundle: vi.fn(), verify: vi.fn(), forget: vi.fn() },
      context: { get: vi.fn(), list: vi.fn(), detail: vi.fn() },
      agentStatus: { get: vi.fn() },
      artifacts: { getMetadata: vi.fn(), getBytes: vi.fn() },
      ...partialHttp,
    },
  } as unknown as OperatorCore;
}

function renderPanels(core: OperatorCore) {
  return renderIntoDocument(
    React.createElement(
      AdminModeProvider,
      { core, mode: "web" },
      React.createElement(AdminHttpPanels, { core }),
    ),
  );
}

function expectElement<T extends Element>(el: T | null): T {
  expect(el).not.toBeNull();
  return el as T;
}

async function clickAndFlush(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

it("sanitizes redirect URLs in the Artifacts download flow", async () => {
  const getBytes = vi.fn(async () => ({ kind: "redirect", url: "javascript:alert(1)" }) as const);
  const core = createStubCore({
    artifacts: { getMetadata: vi.fn(), getBytes },
  });

  const testRoot = renderPanels(core);
  try {
    const artifactsPanel = expectElement(
      testRoot.container.querySelector<HTMLElement>("[data-testid='admin-http-artifacts-panel']"),
    );

    const runIdInput = expectElement(
      artifactsPanel.querySelector<HTMLInputElement>('input[placeholder="uuid"]'),
    );
    const artifactIdInput = expectElement(
      artifactsPanel.querySelector<HTMLInputElement>('input[placeholder="artifact-..."]'),
    );

    act(() => {
      setInputValue(runIdInput, "run-123");
      setInputValue(artifactIdInput, "artifact-123");
    });

    const fetchBytesButton = expectElement(
      artifactsPanel.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-artifacts-download']",
      ),
    );
    await clickAndFlush(fetchBytesButton);

    const openLink = Array.from(artifactsPanel.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Open artifact"),
    );
    expect(openLink).not.toBeUndefined();
    expect(openLink?.getAttribute("href")).toBe(
      "http://example.test/runs/run-123/artifacts/artifact-123",
    );
  } finally {
    cleanupTestRoot(testRoot);
  }
});

it("hides the bytes result card while artifact bytes are loading", async () => {
  const getBytes = vi.fn(async () => new Promise(() => {}));
  const core = createStubCore({
    artifacts: { getMetadata: vi.fn(), getBytes },
  });

  const testRoot = renderPanels(core);
  try {
    const artifactsPanel = expectElement(
      testRoot.container.querySelector<HTMLElement>("[data-testid='admin-http-artifacts-panel']"),
    );

    const runIdInput = expectElement(
      artifactsPanel.querySelector<HTMLInputElement>('input[placeholder="uuid"]'),
    );
    const artifactIdInput = expectElement(
      artifactsPanel.querySelector<HTMLInputElement>('input[placeholder="artifact-..."]'),
    );
    act(() => {
      setInputValue(runIdInput, "run-123");
      setInputValue(artifactIdInput, "artifact-123");
    });

    const fetchBytesButton = expectElement(
      artifactsPanel.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-artifacts-download']",
      ),
    );
    await clickAndFlush(fetchBytesButton);

    expect(artifactsPanel.textContent ?? "").not.toContain("Bytes result");
    expect(artifactsPanel.textContent ?? "").not.toContain("Success");
  } finally {
    cleanupTestRoot(testRoot);
  }
});

async function confirmDangerDialog(): Promise<void> {
  const checkbox = expectElement(
    document.body.querySelector<HTMLElement>('[data-testid="confirm-danger-checkbox"]'),
  );
  act(() => {
    checkbox.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const confirmButton = expectElement(
    document.body.querySelector<HTMLButtonElement>('[data-testid="confirm-danger-confirm"]'),
  );
  await clickAndFlush(confirmButton);
}

it("trims Audit inputs before calling HTTP APIs", async () => {
  const exportReceiptBundle = vi.fn(async () => ({}));
  const forget = vi.fn(async () => ({}));
  const core = createStubCore({
    audit: { exportReceiptBundle, verify: vi.fn(), forget },
  });

  const testRoot = renderPanels(core);
  try {
    const auditPanel = expectElement(
      testRoot.container.querySelector<HTMLElement>("[data-testid='admin-http-audit-panel']"),
    );

    const planIdInput = expectElement(
      auditPanel.querySelector<HTMLInputElement>('input[placeholder="agent-turn-default-..."]'),
    );
    act(() => {
      setInputValue(planIdInput, "  plan-123  ");
    });

    const exportButton = Array.from(auditPanel.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Export receipt bundle"),
    );
    expect(exportButton).not.toBeUndefined();
    await clickAndFlush(exportButton!);

    expect(exportReceiptBundle).toHaveBeenCalledWith("plan-123");

    const entityTypeInput = expectElement(
      auditPanel.querySelector<HTMLInputElement>('input[placeholder="user | session | ..."]'),
    );
    const entityIdInput = expectElement(
      auditPanel.querySelector<HTMLInputElement>('input[placeholder="..."]'),
    );
    act(() => {
      setInputValue(entityTypeInput, "  user  ");
      setInputValue(entityIdInput, "  123  ");
    });

    const openForgetDialogButton = Array.from(auditPanel.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Forget…"),
    );
    expect(openForgetDialogButton).not.toBeUndefined();
    act(() => {
      openForgetDialogButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await confirmDangerDialog();

    expect(forget).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: "user",
        entity_id: "123",
      }),
    );
  } finally {
    cleanupTestRoot(testRoot);
  }
});

it("fetches /healthz unauthenticated from the Health panel", async () => {
  const fetchSpy = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchSpy as unknown as typeof fetch;

  const core = createStubCore({});
  const testRoot = renderPanels(core);
  try {
    const fetchButton = expectElement(
      testRoot.container.querySelector<HTMLButtonElement>(
        "[data-testid='admin-http-health-fetch']",
      ),
    );
    await clickAndFlush(fetchButton);

    expect(fetchSpy).toHaveBeenCalledWith(
      "/healthz",
      expect.objectContaining({ credentials: "omit" }),
    );
  } finally {
    globalThis.fetch = originalFetch;
    cleanupTestRoot(testRoot);
  }
});
