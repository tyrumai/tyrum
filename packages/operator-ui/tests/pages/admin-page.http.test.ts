// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createAdminModeStore, type OperatorCore } from "../../../operator-core/src/index.js";
import { AdminModeProvider } from "../../src/admin-mode.js";
import { AdminPage } from "../../src/components/pages/admin-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(element, value);
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function createTestCore(): {
  core: OperatorCore;
  routingConfigUpdate: ReturnType<typeof vi.fn>;
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
        rotate: vi.fn(async () => ({ revoked: false, handle: {} }) as unknown),
        revoke: vi.fn(async () => ({ revoked: true }) as unknown),
      },
    },
  } as unknown as OperatorCore;

  return { core, routingConfigUpdate };
}

describe("AdminPage (HTTP)", () => {
  it("renders Routing config and Secrets panels", () => {
    const { core } = createTestCore();

    const { container, root } = renderIntoDocument(
      React.createElement(AdminModeProvider, { core, mode: "web" }, [
        React.createElement(AdminPage, { key: "page", core }),
      ]),
    );

    expect(container.querySelector(`[data-testid="admin-http-routing-config"]`)).not.toBeNull();
    expect(container.querySelector(`[data-testid="admin-http-secrets"]`)).not.toBeNull();

    cleanupTestRoot({ container, root });
  });

  it("requires confirmation before updating routing config", async () => {
    const { core, routingConfigUpdate } = createTestCore();

    const { container, root } = renderIntoDocument(
      React.createElement(AdminModeProvider, { core, mode: "web" }, [
        React.createElement(AdminPage, { key: "page", core }),
      ]),
    );

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
