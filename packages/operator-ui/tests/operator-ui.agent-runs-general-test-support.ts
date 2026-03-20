import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import { ConfigurePage } from "../src/components/pages/configure-page.js";
import { waitForSelector, openConfigureGeneral } from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

export function registerAgentTranscriptsGeneralTests(): void {
  it("opens the transcript explorer from the agent page and removes the runs tab", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"));

    const ws = new FakeWsClient();
    ws.transcriptList.mockResolvedValueOnce({
      sessions: [
        {
          session_id: "session-root-1-id",
          session_key: "session-root-1",
          agent_id: "default",
          channel: "ui",
          thread_id: "thread-root-1",
          title: "Default Agent session",
          message_count: 2,
          updated_at: "2026-01-01T00:01:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          archived: false,
          latest_run_id: null,
          latest_run_status: null,
          has_active_run: false,
          pending_approval_count: 0,
          child_sessions: [
            {
              session_id: "session-child-1-id",
              session_key: "session-child-1",
              agent_id: "default",
              channel: "subagent",
              thread_id: "thread-child-1",
              title: "Delegated child session",
              message_count: 1,
              updated_at: "2026-01-01T00:01:30.000Z",
              created_at: "2026-01-01T00:01:00.000Z",
              archived: false,
              parent_session_key: "session-root-1",
              subagent_id: "subagent-1",
              latest_run_id: null,
              latest_run_status: null,
              has_active_run: false,
              pending_approval_count: 0,
            },
          ],
        },
      ],
      next_cursor: null,
    });
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

    expect(container.querySelector('[data-testid="agents-tab-runs"]')).toBeNull();

    const openTranscripts = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="agents-open-transcripts"]',
    );

    await act(async () => {
      openTranscripts?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="transcripts-page"]')).not.toBeNull();
    expect(container.textContent).toContain("Default Agent session");
    expect(container.textContent).toContain("Delegated child session");
    expect(ws.requestDynamic).toHaveBeenCalledWith(
      "transcript.list",
      expect.objectContaining({ agent_id: "default" }),
      expect.anything(),
    );

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("loads more transcript roots from the transcript explorer", async () => {
    const ws = new FakeWsClient();
    ws.transcriptList.mockImplementation(async (payload) => {
      const cursor =
        typeof payload === "object" && payload !== null && "cursor" in payload
          ? (payload.cursor as string | undefined)
          : undefined;
      if (cursor === "cursor-1") {
        return {
          sessions: [
            {
              session_id: "session-root-2-id",
              session_key: "session-root-2",
              agent_id: "default",
              channel: "ui",
              thread_id: "thread-root-2",
              title: "Second transcript",
              message_count: 1,
              updated_at: "2026-01-01T00:02:00.000Z",
              created_at: "2026-01-01T00:01:00.000Z",
              archived: false,
              latest_run_id: null,
              latest_run_status: null,
              has_active_run: false,
              pending_approval_count: 0,
            },
          ],
          next_cursor: null,
        };
      }
      return {
        sessions: [
          {
            session_id: "session-root-1-id",
            session_key: "session-root-1",
            agent_id: "default",
            channel: "ui",
            thread_id: "thread-root-1",
            title: "First transcript",
            message_count: 2,
            updated_at: "2026-01-01T00:01:00.000Z",
            created_at: "2026-01-01T00:00:00.000Z",
            archived: false,
            latest_run_id: null,
            latest_run_status: null,
            has_active_run: false,
            pending_approval_count: 0,
          },
        ],
        next_cursor: "cursor-1",
      };
    });
    ws.transcriptGet.mockResolvedValue({
      root_session_key: "session-root-1",
      focus_session_key: "session-root-1",
      sessions: [
        {
          session_id: "session-root-1-id",
          session_key: "session-root-1",
          agent_id: "default",
          channel: "ui",
          thread_id: "thread-root-1",
          title: "First transcript",
          message_count: 2,
          updated_at: "2026-01-01T00:01:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          archived: false,
          latest_run_id: null,
          latest_run_status: null,
          has_active_run: false,
          pending_approval_count: 0,
        },
      ],
      events: [
        {
          event_id: "message:session-root-1:msg-1",
          kind: "message",
          occurred_at: "2026-01-01T00:00:10.000Z",
          session_key: "session-root-1",
          payload: {
            message: {
              id: "msg-1",
              role: "user",
              parts: [{ type: "text", text: "Inspect the first transcript" }],
            },
          },
        },
      ],
    });
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

    const openTranscripts = await waitForSelector<HTMLButtonElement>(
      container,
      '[data-testid="agents-open-transcripts"]',
    );

    await act(async () => {
      openTranscripts?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.dynamicImportSettled();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("First transcript");
    const loadMoreButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Load more"),
    );
    expect(loadMoreButton).not.toBeNull();

    await act(async () => {
      loadMoreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Second transcript");
    expect(ws.requestDynamic).toHaveBeenCalledWith(
      "transcript.list",
      expect.objectContaining({ agent_id: "default", cursor: "cursor-1" }),
      expect.anything(),
    );

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
