// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it } from "vitest";
import { click, cleanupTestRoot } from "./test-utils.js";
import {
  createCoreStub,
  createDeferred,
  flushEffects,
  getConversationLifecycle,
  renderRetainedAiSdkChatApp,
  setAppShellMinWidth,
  waitForSelector,
} from "./app-retained-ai-sdk-chat.test-support.js";

describe("OperatorUiApp retained AI SDK chat", () => {
  it("keeps the latest chat state visible when approving from the approvals route", async () => {
    const core = createCoreStub();
    const testRoot = renderRetainedAiSdkChatApp(core);

    await waitForSelector(testRoot.container, "[data-testid='mock-conversation']");

    expect(core.sessionClient.list).toHaveBeenCalledWith({
      agent_key: "default",
      channel: "ui",
      limit: 50,
    });
    expect(core.sessionClient.get).toHaveBeenCalledWith({ session_id: "session-1" });
    expect(getConversationLifecycle().mounts).toBe(1);
    expect(testRoot.container.textContent).toContain("user:Run a safe shell command");

    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-toggle-text']") as HTMLElement);
      await Promise.resolve();
    });
    expect(testRoot.container.querySelector("[data-testid='mock-render-mode']")?.textContent).toBe(
      "text",
    );

    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-nav-approvals']") as HTMLElement);
      await Promise.resolve();
    });
    await waitForSelector(testRoot.container, "[data-testid='mock-approve-from-page']");

    await act(async () => {
      click(
        testRoot.container.querySelector("[data-testid='mock-stream-progress']") as HTMLElement,
      );
      await Promise.resolve();
    });
    await flushEffects();

    await act(async () => {
      click(
        testRoot.container.querySelector("[data-testid='mock-approve-from-page']") as HTMLElement,
      );
      await Promise.resolve();
    });
    expect(core.approvalsStore.resolve).toHaveBeenCalledTimes(1);

    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-nav-chat']") as HTMLElement);
      await Promise.resolve();
    });
    await waitForSelector(testRoot.container, "[data-testid='mock-conversation']");

    expect(core.sessionClient.get).toHaveBeenCalledTimes(1);
    expect(getConversationLifecycle().mounts).toBe(1);
    expect(getConversationLifecycle().unmounts).toBe(0);
    expect(testRoot.container.textContent).toContain("user:Run a safe shell command");
    expect(testRoot.container.textContent).toContain("assistant:approval-complete");
    expect(testRoot.container.textContent).toContain("Title session-1:approval-complete");
    expect(testRoot.container.querySelector("[data-testid='mock-render-mode']")?.textContent).toBe(
      "text",
    );

    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-delete']") as HTMLElement);
      await Promise.resolve();
    });
    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-confirm-delete']") as HTMLElement);
      await Promise.resolve();
    });
    await flushEffects();

    expect(core.sessionClient.delete).toHaveBeenCalledWith({ session_id: "session-1" });

    cleanupTestRoot(testRoot);
    expect(getConversationLifecycle().unmounts).toBe(1);
  });

  it("preserves mobile back behavior and the chat approval state across retained routing", async () => {
    setAppShellMinWidth(false);
    const resolveApproval = createDeferred<{ approval: unknown }>();
    const core = createCoreStub({ resolveApproval: () => resolveApproval.promise });
    const testRoot = renderRetainedAiSdkChatApp(core);

    await waitForSelector(testRoot.container, "[data-testid='mock-threads-panel']");
    expect(testRoot.container.querySelector("[data-testid='mock-conversation']")).toBeNull();

    await waitForSelector(testRoot.container, "[data-testid='mock-open-session-1']");
    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-open-session-1']") as HTMLElement);
      await Promise.resolve();
    });
    await waitForSelector(testRoot.container, "[data-testid='mock-conversation']");

    expect(testRoot.container.querySelector("[data-testid='mock-has-back']")?.textContent).toBe(
      "yes",
    );

    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-toggle-text']") as HTMLElement);
      click(
        testRoot.container.querySelector("[data-testid='mock-resolve-from-chat']") as HTMLElement,
      );
      await Promise.resolve();
    });
    await flushEffects();

    expect(testRoot.container.querySelector("[data-testid='mock-render-mode']")?.textContent).toBe(
      "text",
    );
    expect(testRoot.container.querySelector("[data-testid='mock-resolving']")?.textContent).toBe(
      "approval-1",
    );

    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-nav-dashboard']") as HTMLElement);
      await Promise.resolve();
    });
    await waitForSelector(testRoot.container, "[data-testid='mock-dashboard-page']");
    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-nav-chat']") as HTMLElement);
      await Promise.resolve();
    });
    await waitForSelector(testRoot.container, "[data-testid='mock-conversation']");

    expect(getConversationLifecycle().mounts).toBe(1);
    expect(getConversationLifecycle().unmounts).toBe(0);
    expect(testRoot.container.querySelector("[data-testid='mock-has-back']")?.textContent).toBe(
      "yes",
    );
    expect(testRoot.container.querySelector("[data-testid='mock-render-mode']")?.textContent).toBe(
      "text",
    );
    expect(testRoot.container.querySelector("[data-testid='mock-resolving']")?.textContent).toBe(
      "approval-1",
    );

    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-back']") as HTMLElement);
      await Promise.resolve();
    });
    await waitForSelector(testRoot.container, "[data-testid='mock-threads-panel']");

    expect(testRoot.container.querySelector("[data-testid='mock-conversation']")).toBeNull();

    await waitForSelector(testRoot.container, "[data-testid='mock-open-session-1']");
    await act(async () => {
      click(testRoot.container.querySelector("[data-testid='mock-open-session-1']") as HTMLElement);
      resolveApproval.resolve({ approval: {} });
      await Promise.resolve();
    });
    await waitForSelector(testRoot.container, "[data-testid='mock-conversation']");
    await flushEffects();

    expect(testRoot.container.querySelector("[data-testid='mock-resolving']")?.textContent).toBe(
      "",
    );

    cleanupTestRoot(testRoot);
    expect(getConversationLifecycle().unmounts).toBe(2);
  });
});
