// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createAdminModeStore, type OperatorCore } from "../../../operator-core/src/index.js";
import { AdminModeProvider } from "../../src/admin-mode.js";
import { AdminPage } from "../../src/components/pages/admin-page.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

async function switchHttpTab(
  container: HTMLElement,
  tabTestId: string,
): Promise<HTMLButtonElement> {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${tabTestId}"]`);
  expect(button).not.toBeNull();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
  return button!;
}

function createTestCore(): {
  core: OperatorCore;
  routingConfigUpdate: ReturnType<typeof vi.fn>;
  secretsRotate: ReturnType<typeof vi.fn>;
} {
  const adminModeStore = createAdminModeStore({
    tickIntervalMs: 0,
    now: () => Date.parse("2026-03-01T00:00:00.000Z"),
  });
  adminModeStore.enter({
    elevatedToken: "test-elevated-token",
    expiresAt: "2026-03-01T00:01:00.000Z",
  });

  const routingConfigUpdate = vi.fn(async () => ({ revision: 1, config: { v: 1 } }) as unknown);
  const secretsRotate = vi.fn(async () => ({ revoked: true, handle: {} }) as unknown);

  const core = {
    httpBaseUrl: "http://example.test",
    adminModeStore,
    http: {
      routingConfig: {
        get: vi.fn(async () => ({ revision: 0, config: { v: 1 } }) as unknown),
        update: routingConfigUpdate,
        revert: vi.fn(async () => ({ revision: 0, config: { v: 1 } }) as unknown),
      },
      secrets: {
        store: vi.fn(async () => ({ handle: {} }) as unknown),
        list: vi.fn(async () => ({ handles: [] }) as unknown),
        rotate: secretsRotate,
        revoke: vi.fn(async () => ({ revoked: true }) as unknown),
      },
    },
  } as unknown as OperatorCore;

  return { core, routingConfigUpdate, secretsRotate };
}

describe("AdminPage (HTTP)", () => {
  it("renders Routing config and Secrets panels", async () => {
    const { core } = createTestCore();

    const { container, root } = renderIntoDocument(
      React.createElement(AdminModeProvider, { core, mode: "web" }, [
        React.createElement(AdminPage, { key: "page", core }),
      ]),
    );

    await switchHttpTab(container, "admin-http-tab-routing-config");
    expect(container.querySelector(`[data-testid="admin-http-routing-config"]`)).not.toBeNull();

    await switchHttpTab(container, "admin-http-tab-secrets");
    expect(container.querySelector(`[data-testid="admin-http-secrets"]`)).not.toBeNull();

    cleanupTestRoot({ container, root });
  });
});

describe("AdminPage (HTTP) routing config", () => {
  it("requires confirmation before updating routing config", async () => {
    const { core, routingConfigUpdate } = createTestCore();

    const { container, root } = renderIntoDocument(
      React.createElement(AdminModeProvider, { core, mode: "web" }, [
        React.createElement(AdminPage, { key: "page", core }),
      ]),
    );

    await switchHttpTab(container, "admin-http-tab-routing-config");

    const configTextarea = container.querySelector<HTMLTextAreaElement>(
      `[data-testid="routing-config-update-json"]`,
    );
    expect(configTextarea).not.toBeNull();

    act(() => {
      if (!configTextarea) return;
      setNativeValue(configTextarea, JSON.stringify({ v: 1 }));
    });

    const openConfirm = container.querySelector<HTMLButtonElement>(
      `[data-testid="routing-config-update-open"]`,
    );
    expect(openConfirm).not.toBeNull();
    expect(openConfirm?.disabled).toBe(false);

    act(() => {
      openConfirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector(`[data-testid="confirm-danger-dialog"]`);
    expect(dialog).not.toBeNull();

    const confirmButton = document.body.querySelector<HTMLButtonElement>(
      `[data-testid="confirm-danger-confirm"]`,
    );
    expect(confirmButton).not.toBeNull();
    expect(confirmButton?.disabled).toBe(true);

    const checkbox = document.body.querySelector(`[data-testid="confirm-danger-checkbox"]`);
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmButton?.disabled).toBe(false);

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(routingConfigUpdate).toHaveBeenCalledTimes(1);

    cleanupTestRoot({ container, root });
  });
});

describe("AdminPage (HTTP) secrets", () => {
  it("preserves whitespace when rotating secrets", async () => {
    const { core, secretsRotate } = createTestCore();

    const { container, root } = renderIntoDocument(
      React.createElement(AdminModeProvider, { core, mode: "web" }, [
        React.createElement(AdminPage, { key: "page", core }),
      ]),
    );

    await switchHttpTab(container, "admin-http-tab-secrets");

    const rotateButton = container.querySelector<HTMLButtonElement>(
      `[data-testid="secrets-rotate-open"]`,
    );
    expect(rotateButton).not.toBeNull();

    const rotateCard = rotateButton?.closest<HTMLDivElement>("div.rounded-lg");
    expect(rotateCard).not.toBeNull();

    const labels = Array.from(rotateCard?.querySelectorAll<HTMLLabelElement>("label") ?? []);

    const handleIdLabel = labels.find((label) => label.textContent?.trim().startsWith("Handle ID"));
    expect(handleIdLabel).toBeDefined();
    const handleId = handleIdLabel?.getAttribute("for") ?? "";
    expect(handleId).toBeTruthy();
    const handleIdInput = rotateCard?.querySelector<HTMLInputElement>(`input[id="${handleId}"]`);
    expect(handleIdInput).not.toBeNull();

    const valueLabel = labels.find((label) => label.textContent?.trim().startsWith("New value"));
    expect(valueLabel).toBeDefined();
    const valueId = valueLabel?.getAttribute("for") ?? "";
    expect(valueId).toBeTruthy();
    const valueInput = rotateCard?.querySelector<HTMLInputElement>(`input[id="${valueId}"]`);
    expect(valueInput).not.toBeNull();

    act(() => {
      setNativeValue(handleIdInput!, "h-1");
      setNativeValue(valueInput!, "  new-secret  ");
    });

    expect(rotateButton?.disabled).toBe(false);

    act(() => {
      rotateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector(`[data-testid="confirm-danger-dialog"]`);
    expect(dialog).not.toBeNull();

    const checkbox = document.body.querySelector(`[data-testid="confirm-danger-checkbox"]`);
    expect(checkbox).not.toBeNull();

    const confirmButton = document.body.querySelector<HTMLButtonElement>(
      `[data-testid="confirm-danger-confirm"]`,
    );
    expect(confirmButton).not.toBeNull();

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(secretsRotate).toHaveBeenCalledWith("h-1", { value: "  new-secret  " }, undefined);

    cleanupTestRoot({ container, root });
  });
});
