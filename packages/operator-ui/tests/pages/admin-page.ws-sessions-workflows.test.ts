// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createAdminModeStore } from "../../../operator-core/src/index.js";
import { AdminModeProvider } from "../../src/index.js";
import { AdminPage } from "../../src/components/pages/admin-page.js";
import { cleanupTestRoot, createTestRoot, setNativeValue, type TestRoot } from "../test-utils.js";

type WsStub = {
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  sessionSend: ReturnType<typeof vi.fn>;
  workflowRun: ReturnType<typeof vi.fn>;
  workflowResume: ReturnType<typeof vi.fn>;
  workflowCancel: ReturnType<typeof vi.fn>;
};

type AdminWsSetup = {
  core: OperatorCore;
  ws: WsStub;
  testRoot: TestRoot;
  teardown(): void;
};

function queryByTestId<T extends Element>(container: HTMLElement, testId: string): T {
  const element = container.querySelector<T>(`[data-testid="${testId}"]`);
  expect(element).not.toBeNull();
  return element as T;
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): void {
  act(() => {
    setNativeValue(textarea, value);
  });
}

async function clickButton(button: HTMLButtonElement): Promise<void> {
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function switchToWsTab(container: HTMLElement): Promise<void> {
  const wsTab = queryByTestId<HTMLButtonElement>(container, "admin-tab-ws");
  await act(async () => {
    wsTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
}

async function switchToWsSectionTab(container: HTMLElement, testId: string): Promise<void> {
  const tab = queryByTestId<HTMLButtonElement>(container, testId);
  await act(async () => {
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
}

async function setupAdminWsTab(): Promise<AdminWsSetup> {
  const ws: WsStub = {
    on: vi.fn(),
    off: vi.fn(),
    sessionSend: vi.fn(async () => ({ session_id: "session-1", assistant_message: "ok" })),
    workflowRun: vi.fn(async () => ({ run_id: "run-1" })),
    workflowResume: vi.fn(async () => ({ run_id: "run-1" })),
    workflowCancel: vi.fn(async () => ({ run_id: "run-1", cancelled: true })),
  };

  const core = {
    httpBaseUrl: "http://example.test",
    ws,
    adminModeStore: createAdminModeStore(),
  } as unknown as OperatorCore;

  const testRoot = createTestRoot();
  act(() => {
    testRoot.root.render(
      React.createElement(AdminModeProvider, {
        core,
        mode: "desktop",
        children: React.createElement(AdminPage, { core }),
      }),
    );
  });

  act(() => {
    core.adminModeStore.enter({
      elevatedToken: "elevated-1",
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
  });

  await switchToWsTab(testRoot.container);

  return {
    core,
    ws,
    testRoot,
    teardown() {
      cleanupTestRoot(testRoot);
    },
  };
}

async function wiresSessionSendPanel(): Promise<void> {
  const setup = await setupAdminWsTab();
  try {
    await switchToWsSectionTab(setup.testRoot.container, "admin-ws-tab-sessions");

    const sessionPayload = queryByTestId<HTMLTextAreaElement>(
      setup.testRoot.container,
      "admin-ws-session-send-payload",
    );
    const sessionExecute = queryByTestId<HTMLButtonElement>(
      setup.testRoot.container,
      "admin-ws-session-send-execute",
    );

    setTextareaValue(
      sessionPayload,
      JSON.stringify({ channel: "test", thread_id: "thread-1", content: "Hello" }),
    );
    await clickButton(sessionExecute);

    expect(setup.ws.sessionSend).toHaveBeenCalledWith({
      channel: "test",
      thread_id: "thread-1",
      content: "Hello",
    });
    expect(
      setup.testRoot.container.querySelector('[data-testid="admin-ws-session-send-result"]'),
    ).not.toBeNull();

    setTextareaValue(sessionPayload, "{");
    await clickButton(sessionExecute);

    expect(setup.ws.sessionSend).toHaveBeenCalledTimes(1);
    expect(
      setup.testRoot.container.querySelector('[data-testid="admin-ws-session-send-result"]'),
    ).toBeNull();
  } finally {
    setup.teardown();
  }
}

async function wiresWorkflowPanels(): Promise<void> {
  const setup = await setupAdminWsTab();
  try {
    await switchToWsSectionTab(setup.testRoot.container, "admin-ws-tab-workflows");

    const workflowRunPayload = queryByTestId<HTMLTextAreaElement>(
      setup.testRoot.container,
      "admin-ws-workflow-run-payload",
    );
    const workflowRunExecute = queryByTestId<HTMLButtonElement>(
      setup.testRoot.container,
      "admin-ws-workflow-run-execute",
    );

    setTextareaValue(
      workflowRunPayload,
      JSON.stringify({ key: "node:node-1", lane: "main", steps: [{ type: "Decide", args: {} }] }),
    );
    await clickButton(workflowRunExecute);
    expect(setup.ws.workflowRun).toHaveBeenCalledWith({
      key: "node:node-1",
      lane: "main",
      steps: [{ type: "Decide", args: {} }],
    });

    const workflowResumePayload = queryByTestId<HTMLTextAreaElement>(
      setup.testRoot.container,
      "admin-ws-workflow-resume-payload",
    );
    const workflowResumeExecute = queryByTestId<HTMLButtonElement>(
      setup.testRoot.container,
      "admin-ws-workflow-resume-execute",
    );

    setTextareaValue(workflowResumePayload, JSON.stringify({ token: "resume-token-1" }));
    await clickButton(workflowResumeExecute);
    expect(setup.ws.workflowResume).toHaveBeenCalledWith({ token: "resume-token-1" });

    const workflowCancelPayload = queryByTestId<HTMLTextAreaElement>(
      setup.testRoot.container,
      "admin-ws-workflow-cancel-payload",
    );
    const workflowCancelExecute = queryByTestId<HTMLButtonElement>(
      setup.testRoot.container,
      "admin-ws-workflow-cancel-execute",
    );

    setTextareaValue(workflowCancelPayload, JSON.stringify({ run_id: "run-1", reason: "stop" }));
    await clickButton(workflowCancelExecute);
    expect(setup.ws.workflowCancel).toHaveBeenCalledWith({ run_id: "run-1", reason: "stop" });
  } finally {
    setup.teardown();
  }
}

describe("admin-page", () => {
  it("shows session.send result and clears it on invalid payload", wiresSessionSendPanel);
  it("wires workflow.run/resume/cancel panels", wiresWorkflowPanels);
});

