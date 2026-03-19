import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import { ConfigurePage } from "../src/components/pages/configure-page.js";
import { waitForSelector, openConfigureGeneral } from "./operator-ui.test-support.js";
import {
  FakeWsClient,
  createFakeHttpClient,
  sampleExecutionRun,
  sampleExecutionStep,
  sampleExecutionAttempt,
} from "./operator-ui.test-fixtures.js";

export function registerAgentRunsGeneralTests(): void {
  it("renders incoming runs on the agent runs tab", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"));

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    act(() => {
      core.connect();
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    const agentsLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-agents"]');
    expect(agentsLink).not.toBeNull();

    await act(async () => {
      agentsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const runsTab = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="agents-tab-runs"]',
    );

    act(() => {
      runsTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });

    expect(container.textContent).toContain("No runs yet");
    expect(container.textContent).toContain(
      "Runs for this agent appear here when it starts executing.",
    );

    act(() => {
      ws.emit("run.updated", { payload: { run: sampleExecutionRun() } });
    });

    const runStatusBadge = container.querySelector<HTMLSpanElement>(
      `[data-testid="run-status-${sampleExecutionRun().run_id}"]`,
    );
    expect(runStatusBadge).not.toBeNull();
    expect(runStatusBadge?.textContent).toContain("running");
    expect(runStatusBadge?.getAttribute("aria-live")).toBe("polite");
    expect(runStatusBadge?.getAttribute("aria-atomic")).toBe("true");
    expect(container.textContent).toContain("beefcafe");
    expect(container.textContent).toContain("2m ago");

    const step0 = sampleExecutionStep({
      stepId: "33333333-3333-3333-3333-0123456789ab",
      stepIndex: 0,
      status: "queued",
      actionType: "Decide",
    });
    const step1 = sampleExecutionStep({
      stepId: "33333333-3333-3333-3333-acde0000babe",
      stepIndex: 1,
      status: "running",
      actionType: "Research",
    });

    act(() => {
      ws.emit("step.updated", { payload: { step: step1 } });
      ws.emit("step.updated", { payload: { step: step0 } });
    });

    const attempt2 = sampleExecutionAttempt({
      attemptId: "44444444-4444-4444-4444-acde0000beef",
      stepId: step0.step_id,
      attempt: 2,
      status: "running",
    });
    const attempt1 = sampleExecutionAttempt({
      attemptId: "44444444-4444-4444-4444-acde0000face",
      stepId: step0.step_id,
      attempt: 1,
      status: "succeeded",
      finishedAt: "2026-01-01T00:00:05.000Z",
    });

    act(() => {
      ws.emit("attempt.updated", { payload: { attempt: attempt2 } });
      ws.emit("attempt.updated", { payload: { attempt: attempt1 } });
    });

    const runToggle = container.querySelector<HTMLButtonElement>(
      `[data-testid="run-toggle-${sampleExecutionRun().run_id}"]`,
    );
    expect(runToggle).not.toBeNull();

    act(() => {
      runToggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const pageText = container.textContent ?? "";
    expect(pageText).toContain("Step 0");
    expect(pageText).toContain("Step 1");
    expect(pageText.indexOf("Step 0")).toBeLessThan(pageText.indexOf("Step 1"));

    expect(pageText).toContain("queued");
    expect(container.textContent).toContain("Decide");
    expect(container.textContent).toContain("Research");
    expect(pageText.indexOf("Attempt 1")).toBeLessThan(pageText.indexOf("Attempt 2"));
    expect(pageText).toContain("completed • 5s");

    expect(container.textContent).toContain("Attempt 1");
    expect(container.textContent).toContain("456789ab");
    expect(container.textContent).toContain("0000face");
    expect(container.textContent).toContain("0000beef");

    const writeText = vi.fn(async () => {});
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    const toastSuccess = vi.spyOn(toast, "success");

    const copyRunId = container.querySelector<HTMLButtonElement>(
      `[data-testid="copy-id-${sampleExecutionRun().run_id}"]`,
    );
    expect(copyRunId).not.toBeNull();
    expect(copyRunId?.getAttribute("aria-label")).toBe(`Copy ID ${sampleExecutionRun().run_id}`);

    await act(async () => {
      copyRunId?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(sampleExecutionRun().run_id);
    expect(toastSuccess).toHaveBeenCalledWith("Copied to clipboard");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders theme and update cards in Configure general", async () => {
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });
    act(() => {
      core.connect();
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    await openConfigureGeneral(container);

    expect(container.querySelector('[data-testid="configure-general-panel"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="configure-theme"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="configure-update"]')).not.toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("shows browser token status in Configure general and forgets the saved token", async () => {
    const clearToken = vi.fn(async () => {});
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(ConfigurePage, {
          core,
          mode: "web",
          webAuthPersistence: {
            hasStoredToken: true,
            saveToken: vi.fn(),
            clearToken,
          },
        }),
      );
    });

    expect(container.querySelector('[data-testid="configure-web-auth"]')).not.toBeNull();
    expect(container.textContent).toContain("Token saved");

    const clearButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="configure-web-auth-clear"]',
    );
    expect(clearButton).not.toBeNull();

    await act(async () => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(clearToken).toHaveBeenCalledTimes(1);
    expect(ws.disconnect).toHaveBeenCalledTimes(1);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("shows an error in Configure general when forgetting the saved token fails", async () => {
    const clearToken = vi.fn(async () => {
      throw new Error("forget failed");
    });
    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(ConfigurePage, {
          core,
          mode: "web",
          webAuthPersistence: {
            hasStoredToken: true,
            saveToken: vi.fn(),
            clearToken,
          },
        }),
      );
    });

    const clearButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="configure-web-auth-clear"]',
    );
    expect(clearButton).not.toBeNull();

    await act(async () => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("switches theme mode from Configure general", async () => {
    const localStorageMock = {
      getItem: vi.fn((key: string) => (key === "tyrum.themeMode" ? "dark" : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", localStorageMock as unknown as Storage);

    const ws = new FakeWsClient();
    const { http } = createFakeHttpClient();
    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(React.createElement(OperatorUiApp, { core, mode: "desktop" }));
    });

    await openConfigureGeneral(container);

    const lightOption = container.querySelector<HTMLButtonElement>(
      '[data-testid="configure-theme-light"]',
    );
    expect(lightOption).not.toBeNull();

    await act(async () => {
      lightOption?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}
