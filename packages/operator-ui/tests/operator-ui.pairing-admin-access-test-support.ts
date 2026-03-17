import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createBearerTokenAuth,
  createOperatorCore,
  ElevatedModeRequiredError,
} from "../../operator-core/src/index.js";
import { AdminAccessProvider, OperatorUiApp } from "../src/index.js";
import * as operatorUi from "../src/index.js";
import { PairingPage } from "../src/components/pages/pairing-page.js";
import { createOperatorUiTestCoreWithAdminAccess } from "./operator-ui.admin-access-test-support.js";
import {
  FakeWsClient,
  createFakeHttpClient,
  samplePairingRequestApproved,
  samplePairingRequestPending,
} from "./operator-ui.test-fixtures.js";

const NOOP_ADMIN_ACCESS_CONTROLLER = {
  enter: async () => {},
  exit: async () => {},
};

function renderDirectPairingPage(
  root: Root,
  core: Parameters<typeof PairingPage>[0]["core"],
): void {
  root.render(
    React.createElement(
      AdminAccessProvider,
      {
        core,
        mode: "desktop",
        adminAccessController: NOOP_ADMIN_ACCESS_CONTROLLER,
      },
      React.createElement(PairingPage, { core }),
    ),
  );
}

async function flushPairingPage(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function expandNodeRow(container: HTMLElement, nodeId = "node-1"): void {
  const toggle = container.querySelector<HTMLButtonElement>(
    `[data-testid="pairing-row-toggle-${nodeId}"]`,
  );
  expect(toggle).not.toBeNull();
  act(() => {
    toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

export function registerPairingAdminAccessTests(): void {
  it("prompts for admin access before approving when elevated access is inactive", async () => {
    const toastError = vi
      .spyOn(operatorUi.toast as unknown as { error: (message: string) => void }, "error")
      .mockImplementation(() => {});
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });

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

    const pairingLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-pairing"]');
    expect(pairingLink).not.toBeNull();
    act(() => {
      pairingLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await flushPairingPage();
    });

    expandNodeRow(container);
    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsApprove).toHaveBeenCalledTimes(0);
    expect(document.querySelector('[data-testid="elevated-mode-dialog"]')).not.toBeNull();
    expect(toastError).not.toHaveBeenCalled();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("does not get stuck in a loading state under StrictMode when approve fails", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });
    pairingsApprove.mockRejectedValueOnce(new Error("nope"));
    vi.spyOn(
      operatorUi.toast as unknown as { error: (message: string) => void },
      "error",
    ).mockImplementation(() => {});

    const core = createOperatorUiTestCoreWithAdminAccess({ ws, http });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      root.render(
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(
            AdminAccessProvider,
            {
              core,
              mode: "desktop",
              adminAccessController: NOOP_ADMIN_ACCESS_CONTROLLER,
            },
            React.createElement(PairingPage, { core }),
          ),
        ),
      );
    });

    await act(async () => {
      await flushPairingPage();
    });

    expandNodeRow(container);
    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsApprove).toHaveBeenCalledTimes(1);

    const approveButtonAfter = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButtonAfter).not.toBeNull();
    expect(approveButtonAfter?.disabled).toBe(false);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("re-prompts for admin access and clears loading when approve races with expiry", async () => {
    const toastError = vi
      .spyOn(operatorUi.toast as unknown as { error: (message: string) => void }, "error")
      .mockImplementation(() => {});
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });
    pairingsApprove.mockRejectedValueOnce(
      new ElevatedModeRequiredError("Authorize admin access to manage device pairings."),
    );

    const core = createOperatorUiTestCoreWithAdminAccess({ ws, http });

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      renderDirectPairingPage(root, core);
    });

    await act(async () => {
      await flushPairingPage();
    });

    expandNodeRow(container);
    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    const approveButtonAfter = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(pairingsApprove).toHaveBeenCalledTimes(1);
    expect(approveButtonAfter?.disabled).toBe(false);
    expect(document.querySelector('[data-testid="elevated-mode-dialog"]')).not.toBeNull();
    expect(toastError).not.toHaveBeenCalled();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("prompts for admin access before denying when elevated access is inactive", async () => {
    const toastError = vi
      .spyOn(operatorUi.toast as unknown as { error: (message: string) => void }, "error")
      .mockImplementation(() => {});
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsDeny } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });

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

    const pairingLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-pairing"]');
    expect(pairingLink).not.toBeNull();
    act(() => {
      pairingLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await flushPairingPage();
    });

    expandNodeRow(container);
    const denyButton = container.querySelector<HTMLButtonElement>('[data-testid="pairing-deny-1"]');
    expect(denyButton).not.toBeNull();

    await act(async () => {
      denyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsDeny).toHaveBeenCalledTimes(0);
    expect(document.querySelector('[data-testid="elevated-mode-dialog"]')).not.toBeNull();
    expect(toastError).not.toHaveBeenCalled();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("prompts for admin access before revoking when elevated access is inactive", async () => {
    const toastError = vi
      .spyOn(operatorUi.toast as unknown as { error: (message: string) => void }, "error")
      .mockImplementation(() => {});
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsRevoke } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({
      status: "ok",
      pairings: [samplePairingRequestApproved()],
    });

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

    const pairingLink = container.querySelector<HTMLButtonElement>('[data-testid="nav-pairing"]');
    expect(pairingLink).not.toBeNull();
    act(() => {
      pairingLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await flushPairingPage();
    });

    expandNodeRow(container);
    const revokeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-revoke-1"]',
    );
    expect(revokeButton).not.toBeNull();

    await act(async () => {
      revokeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsRevoke).toHaveBeenCalledTimes(0);
    expect(document.querySelector('[data-testid="elevated-mode-dialog"]')).not.toBeNull();
    expect(toastError).not.toHaveBeenCalled();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}
