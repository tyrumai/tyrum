// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import type { AdminModeState, AdminModeStore } from "../../../operator-core/src/stores/admin-mode-store.js";
import { AdminModeProvider } from "../../src/admin-mode.js";
import { AdminPage } from "../../src/components/pages/admin-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

/**
 * Sets a value on a React-controlled input/textarea by going through the
 * native property setter so React's internal value tracker is updated.
 */
function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) {
    setter.call(element, value);
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Click helper that dispatches the full pointer/mouse sequence Radix components expect. */
function click(element: HTMLElement): void {
  element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  element.click();
  element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

function createActiveAdminModeStore(): AdminModeStore {
  const activeState: AdminModeState = {
    status: "active",
    elevatedToken: "token",
    enteredAt: "2026-03-01T00:00:00.000Z",
    expiresAt: "2026-03-01T00:10:00.000Z",
    remainingMs: 60_000,
  };

  const { store } = createStore(activeState);
  return {
    ...store,
    enter: vi.fn(),
    exit: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("AdminPage WorkBoard WS panels", () => {
  it("wires WorkScope + payload JSON to core WorkBoard operations", async () => {
    const workList = vi.fn(async () => ({
      items: [
        {
          work_item_id: "work-1",
          tenant_id: "tenant-1",
          agent_id: "agent-1",
          workspace_id: "ws-1",
          kind: "action",
          title: "First work item",
          status: "ready",
          priority: 0,
          created_at: "2026-03-01T00:00:00Z",
          created_from_session_key: "session-1",
          last_active_at: null,
          parent_work_item_id: null,
        },
      ],
    }));
    const workGet = vi.fn(async () => ({ item: { work_item_id: "work-1" } as unknown }));
    const workCreate = vi.fn(async () => ({ item: { work_item_id: "work-2" } as unknown }));
    const workUpdate = vi.fn(async () => ({ item: { work_item_id: "work-1" } as unknown }));
    const workTransition = vi.fn(async () => ({ item: { work_item_id: "work-1" } as unknown }));

    const adminModeStore = createActiveAdminModeStore();

    const core = {
      httpBaseUrl: "http://example.test",
      adminModeStore,
      ws: {
        workList,
        workGet,
        workCreate,
        workUpdate,
        workTransition,
      },
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(
      React.createElement(AdminModeProvider, {
        core,
        mode: "web",
        children: React.createElement(AdminPage, { core }),
      }),
    );

    const wsTab = testRoot.container.querySelector<HTMLButtonElement>('[data-testid="admin-tab-ws"]');
    expect(wsTab).not.toBeNull();
    await act(async () => {
      click(wsTab!);
    });

    const tenant = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="work-scope-tenant-id"]',
    );
    const agent = testRoot.container.querySelector<HTMLInputElement>('[data-testid="work-scope-agent-id"]');
    const workspace = testRoot.container.querySelector<HTMLInputElement>(
      '[data-testid="work-scope-workspace-id"]',
    );
    expect(tenant).not.toBeNull();
    expect(agent).not.toBeNull();
    expect(workspace).not.toBeNull();

    await act(async () => {
      setNativeValue(tenant!, "tenant-1");
      setNativeValue(agent!, "agent-1");
      setNativeValue(workspace!, "ws-1");
    });

    const listPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-list-payload"]',
    );
    const listRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-list-run"]',
    );
    expect(listPayload).not.toBeNull();
    expect(listRun).not.toBeNull();

    await act(async () => {
      setNativeValue(listPayload!, JSON.stringify({ limit: 1 }));
      click(listRun!);
      await Promise.resolve();
    });

    expect(workList).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      limit: 1,
    });
    expect(testRoot.container.textContent).toContain("First work item");

    const getPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-get-payload"]',
    );
    const getRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-get-run"]',
    );
    expect(getPayload).not.toBeNull();
    expect(getRun).not.toBeNull();

    await act(async () => {
      setNativeValue(getPayload!, JSON.stringify({ tenant_id: "bad", work_item_id: "work-1" }));
      click(getRun!);
      await Promise.resolve();
    });

    expect(workGet).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      work_item_id: "work-1",
    });

    const createPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-create-payload"]',
    );
    const createRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-create-run"]',
    );
    expect(createPayload).not.toBeNull();
    expect(createRun).not.toBeNull();

    await act(async () => {
      setNativeValue(createPayload!, JSON.stringify({ item: { kind: "action", title: "New item" } }));
      click(createRun!);
      await Promise.resolve();
    });

    expect(workCreate).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      item: { kind: "action", title: "New item" },
    });

    const updatePayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-update-payload"]',
    );
    const updateRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-update-run"]',
    );
    expect(updatePayload).not.toBeNull();
    expect(updateRun).not.toBeNull();

    await act(async () => {
      setNativeValue(updatePayload!, JSON.stringify({ work_item_id: "work-1", patch: { title: "Updated" } }));
      click(updateRun!);
      await Promise.resolve();
    });

    expect(workUpdate).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      work_item_id: "work-1",
      patch: { title: "Updated" },
    });

    const transitionPayload = testRoot.container.querySelector<HTMLTextAreaElement>(
      '[data-testid="admin-ws-work-transition-payload"]',
    );
    const transitionRun = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-ws-work-transition-run"]',
    );
    expect(transitionPayload).not.toBeNull();
    expect(transitionRun).not.toBeNull();

    await act(async () => {
      setNativeValue(
        transitionPayload!,
        JSON.stringify({ work_item_id: "work-1", status: "done", reason: "ok" }),
      );
      click(transitionRun!);
      await Promise.resolve();
    });

    expect(workTransition).toHaveBeenCalledWith({
      tenant_id: "tenant-1",
      agent_id: "agent-1",
      workspace_id: "ws-1",
      work_item_id: "work-1",
      status: "done",
      reason: "ok",
    });

    cleanupTestRoot(testRoot);
  });
});

