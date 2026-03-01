// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { AdminModeProvider } from "../../src/admin-mode.js";
import { AdminPage } from "../../src/components/pages/admin-page.js";
import { SubagentsPanels } from "../../src/components/admin-ws/subagents-panels.js";
import {
  cleanupTestRoot,
  clickRadix as click,
  renderIntoDocument,
  setNativeValue,
} from "../test-utils.js";

function createAdminModeStoreActive() {
  const { store } = createStore({
    status: "active",
    elevatedToken: "token-1",
    enteredAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:10:00.000Z",
    remainingMs: 60_000,
  });

  return {
    ...store,
    enter: vi.fn(),
    exit: vi.fn(),
    dispose: vi.fn(),
  };
}

type WsMock = ReturnType<typeof createWsMock>;
type SubagentWsMethod =
  | "subagentSpawn"
  | "subagentList"
  | "subagentGet"
  | "subagentSend"
  | "subagentClose";

function createWsMock() {
  return {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    subagentSpawn: vi.fn(async () => ({})),
    subagentList: vi.fn(async () => ({})),
    subagentGet: vi.fn(async () => ({})),
    subagentSend: vi.fn(async () => ({})),
    subagentClose: vi.fn(async () => ({})),
  };
}

function getByTestId<T extends Element>(container: HTMLElement, testId: string): T {
  const element = container.querySelector<T>(`[data-testid="${testId}"]`);
  expect(element).not.toBeNull();
  return element as T;
}

async function openWsTab(container: HTMLElement): Promise<void> {
  const wsTab = getByTestId<HTMLButtonElement>(container, "admin-tab-ws");
  await act(async () => {
    click(wsTab);
  });
}

async function writePayload(
  container: HTMLElement,
  testId: string,
  payload: unknown,
): Promise<void> {
  const textarea = getByTestId<HTMLTextAreaElement>(container, testId);
  await act(async () => {
    setNativeValue(textarea, JSON.stringify(payload, null, 2));
  });
}

async function submit(container: HTMLElement, testId: string): Promise<void> {
  const button = getByTestId<HTMLButtonElement>(container, testId);
  await act(async () => {
    click(button);
  });
  await act(async () => {});
}

function createCore(ws: WsMock): OperatorCore {
  return {
    wsUrl: "ws://example.test/ws",
    httpBaseUrl: "http://example.test",
    ws,
    adminModeStore: createAdminModeStoreActive(),
  } as unknown as OperatorCore;
}

describe("AdminPage (WS Subagents)", () => {
  it("wires WebSocket requests for subagent operations", async () => {
    const scope = { tenant_id: "tenant-1", agent_id: "agent-1", workspace_id: "default" } as const;
    const subagentId = "123e4567-e89b-12d3-a456-426614174222";

    const ws = createWsMock();
    const core = createCore(ws);

    const testRoot = renderIntoDocument(
      React.createElement(
        AdminModeProvider,
        { core, mode: "desktop" },
        React.createElement(AdminPage, { core }),
      ),
    );

    await openWsTab(testRoot.container);
    expect(testRoot.container.querySelector('[data-testid="admin-ws-subagents"]')).not.toBeNull();

    const cases = [
      {
        payloadTestId: "admin-ws-subagent-spawn-payload",
        submitTestId: "admin-ws-subagent-spawn-submit",
        method: "subagentSpawn",
        payload: { ...scope, execution_profile: "default" },
      },
      {
        payloadTestId: "admin-ws-subagent-list-payload",
        submitTestId: "admin-ws-subagent-list-submit",
        method: "subagentList",
        payload: { ...scope, statuses: ["running"], limit: 20 },
      },
      {
        payloadTestId: "admin-ws-subagent-get-payload",
        submitTestId: "admin-ws-subagent-get-submit",
        method: "subagentGet",
        payload: { ...scope, subagent_id: subagentId },
      },
      {
        payloadTestId: "admin-ws-subagent-send-payload",
        submitTestId: "admin-ws-subagent-send-submit",
        method: "subagentSend",
        payload: { ...scope, subagent_id: subagentId, content: "Hello" },
      },
      {
        payloadTestId: "admin-ws-subagent-close-payload",
        submitTestId: "admin-ws-subagent-close-submit",
        method: "subagentClose",
        payload: { ...scope, subagent_id: subagentId, reason: "done" },
      },
    ] as const satisfies ReadonlyArray<{
      method: SubagentWsMethod;
      payloadTestId: string;
      submitTestId: string;
      payload: unknown;
    }>;

    for (const c of cases) {
      await writePayload(testRoot.container, c.payloadTestId, c.payload);
      await submit(testRoot.container, c.submitTestId);
      expect(ws[c.method]).toHaveBeenCalledWith(c.payload as never);
    }

    cleanupTestRoot(testRoot);
  });
});

describe("SubagentsPanels", () => {
  it("avoids double-parsing JSON payloads on render", () => {
    const parseSpy = vi.spyOn(JSON, "parse");

    const ws = createWsMock();
    const core = { ws } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(React.createElement(SubagentsPanels, { core }));

    const payloadTextareas = testRoot.container.querySelectorAll(
      'textarea[data-testid$="-payload"]',
    );
    expect(payloadTextareas.length).toBeGreaterThan(0);
    expect(parseSpy).toHaveBeenCalledTimes(payloadTextareas.length);

    parseSpy.mockRestore();
    cleanupTestRoot(testRoot);
  });
});
