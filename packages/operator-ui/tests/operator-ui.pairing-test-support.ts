import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import * as operatorUi from "../src/index.js";
import { PairingPage } from "../src/components/pages/pairing-page.js";
import {
  FakeWsClient,
  createFakeHttpClient,
  samplePairingRequestPending,
  samplePairingRequestPendingWithNodeCapabilities,
  samplePairingRequestApproved,
} from "./operator-ui.test-fixtures.js";

function registerPairingApproveTests(): void {
  it("lists and approves pairing requests", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });
    pairingsApprove.mockResolvedValueOnce({
      status: "ok",
      pairing: samplePairingRequestApproved(),
    });
    const toastSuccess = vi
      .spyOn(operatorUi.toast as unknown as { success: (message: string) => void }, "success")
      .mockImplementation(() => {});

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
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pairingsList).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("node-1");

    const takeoverLink = container.querySelector<HTMLAnchorElement>(
      '[data-testid="pairing-takeover-1"]',
    );
    expect(takeoverLink).not.toBeNull();
    expect(takeoverLink?.getAttribute("href")).toBe(
      "http://localhost:6080/vnc.html?autoconnect=true",
    );

    const trustRemote = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-trust-level-1-remote"]',
    );
    expect(trustRemote).not.toBeNull();
    act(() => {
      trustRemote?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const capability0 = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-capability-1-0"]',
    );
    expect(capability0).not.toBeNull();
    act(() => {
      capability0?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const reason = container.querySelector<HTMLTextAreaElement>('[data-testid="pairing-reason-1"]');
    expect(reason).not.toBeNull();
    act(() => {
      if (!reason) return;
      reason.value = "ok";
      reason.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });

    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsApprove).toHaveBeenCalledTimes(1);
    expect(pairingsApprove).toHaveBeenCalledWith(1, {
      trust_level: "remote",
      capability_allowlist: [{ id: "tyrum.http", version: "1.0.0" }],
      reason: "ok",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Pairing approved");

    const approveButtonAfter = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButtonAfter).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("derives pairing capability allowlist options from node capabilities", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({
      status: "ok",
      pairings: [samplePairingRequestPendingWithNodeCapabilities()],
    });
    pairingsApprove.mockResolvedValueOnce({
      status: "ok",
      pairing: samplePairingRequestApproved(),
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
      await Promise.resolve();
      await Promise.resolve();
    });

    const capability0 = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-capability-1-0"]',
    );
    expect(capability0).not.toBeNull();
    act(() => {
      capability0?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsApprove).toHaveBeenCalledWith(1, {
      trust_level: "local",
      capability_allowlist: [{ id: "tyrum.http", version: "1.0.0" }],
    });

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
        React.createElement(React.StrictMode, null, React.createElement(PairingPage, { core })),
      );
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

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

  it("disables deny while approve is in flight", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });

    let resolveApprove: ((value: unknown) => void) | null = null;
    const approvePromise = new Promise((resolve) => {
      resolveApprove = resolve;
    });
    pairingsApprove.mockImplementationOnce(() => approvePromise as never);

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
      root.render(React.createElement(PairingPage, { core }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-approve-1"]',
    );
    expect(approveButton).not.toBeNull();

    act(() => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const denyButtonWhileBusy = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-deny-1"]',
    );
    expect(denyButtonWhileBusy).not.toBeNull();
    expect(denyButtonWhileBusy?.disabled).toBe(true);

    await act(async () => {
      resolveApprove?.({ status: "ok", pairing: samplePairingRequestApproved() });
      await Promise.resolve();
    });

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("labels pairing groups with fieldset legends", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList } = createFakeHttpClient();
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
      root.render(React.createElement(PairingPage, { core }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const legends = Array.from(container.querySelectorAll("legend")).map((node) =>
      (node.textContent ?? "").trim(),
    );
    expect(legends.some((text) => text.includes("Trust level"))).toBe(true);
    expect(legends.some((text) => text.includes("Capabilities"))).toBe(true);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}

function registerPairingDenyRevokeTests(): void {
  it("renders pairing empty state when no pending requests", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [] });

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
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pairingsList).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("No pairing requests");
    expect(container.textContent).toContain(
      "Pairing requests appear when devices want to connect.",
    );

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("denies pairing requests with toast feedback", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsDeny } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });
    pairingsDeny.mockResolvedValueOnce({
      status: "ok",
      pairing: {
        ...samplePairingRequestPending(),
        status: "denied",
        resolution: {
          decision: "denied",
          resolved_at: "2026-01-01T00:00:01.000Z",
          reason: "no",
        },
        resolved_at: "2026-01-01T00:00:01.000Z",
      },
    });
    const toastSuccess = vi
      .spyOn(operatorUi.toast as unknown as { success: (message: string) => void }, "success")
      .mockImplementation(() => {});

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
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pairingsList).toHaveBeenCalledTimes(1);

    const denyButton = container.querySelector<HTMLButtonElement>('[data-testid="pairing-deny-1"]');
    expect(denyButton).not.toBeNull();

    await act(async () => {
      denyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsDeny).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Pairing denied");

    const denyButtonAfter = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-deny-1"]',
    );
    expect(denyButtonAfter).toBeNull();

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders approved pairings with a revoke button", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, pairingsRevoke } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({
      status: "ok",
      pairings: [samplePairingRequestApproved()],
    });
    pairingsRevoke.mockResolvedValueOnce({
      status: "ok",
      pairing: {
        ...samplePairingRequestApproved(),
        status: "revoked",
        resolution: {
          decision: "revoked",
          resolved_at: "2026-01-01T00:00:02.000Z",
          reason: "revoked",
        },
        resolved_at: "2026-01-01T00:00:02.000Z",
      },
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
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pairingsList).toHaveBeenCalledTimes(1);

    const revokeButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="pairing-revoke-1"]',
    );
    expect(revokeButton).not.toBeNull();

    await act(async () => {
      revokeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(pairingsRevoke).toHaveBeenCalledTimes(1);

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}

export function registerPairingTests(): void {
  registerPairingApproveTests();
  registerPairingDenyRevokeTests();
}
