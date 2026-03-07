import { expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createBearerTokenAuth,
  createOperatorCore,
} from "../../operator-core/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import * as operatorUi from "../src/index.js";
import {
  FakeWsClient,
  createFakeHttpClient,
  sampleApprovalPending,
  sampleApprovalApproved,
} from "./operator-ui.test-fixtures.js";

export function registerApprovalsTests(): void {
  it("lists and resolves pending approvals", async () => {
    const toastSuccess = vi
      .spyOn(operatorUi.toast, "success")
      .mockImplementation(() => "" as unknown as string);

    const ws = new FakeWsClient();
    ws.approvalList.mockResolvedValueOnce({
      approvals: [sampleApprovalPending()],
      next_cursor: undefined,
    });
    ws.approvalResolve.mockResolvedValueOnce({ approval: sampleApprovalApproved() });

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

    const approvalsLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-approvals"]',
    );
    expect(approvalsLink).not.toBeNull();

    act(() => {
      approvalsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const approvalsLiveRegion = container.querySelector<HTMLDivElement>(
      '[data-testid="approvals-pending-live"]',
    );
    expect(approvalsLiveRegion).not.toBeNull();
    expect(approvalsLiveRegion?.getAttribute("aria-live")).toBe("polite");
    expect(approvalsLiveRegion?.getAttribute("aria-atomic")).toBe("true");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ws.approvalList).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Allow the tool call?");
    expect(container.textContent).toContain("other");
    expect(container.querySelector('time[datetime="2026-01-01T00:00:00.000Z"]')).not.toBeNull();

    const approveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="approval-approve-1"]',
    );
    expect(approveButton).not.toBeNull();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(ws.approvalResolve).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Approval resolved");
    expect(container.textContent).not.toContain("Allow the tool call?");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("denies approvals with toast feedback", async () => {
    const toastSuccess = vi
      .spyOn(operatorUi.toast, "success")
      .mockImplementation(() => "" as unknown as string);

    const ws = new FakeWsClient();
    ws.approvalList.mockResolvedValueOnce({
      approvals: [sampleApprovalPending()],
      next_cursor: undefined,
    });
    ws.approvalResolve.mockResolvedValueOnce({
      approval: { ...sampleApprovalPending(), status: "denied" },
    });

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

    const approvalsLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-approvals"]',
    );
    expect(approvalsLink).not.toBeNull();

    act(() => {
      approvalsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const denyButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="approval-deny-1"]',
    );
    expect(denyButton).not.toBeNull();

    await act(async () => {
      denyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(ws.approvalResolve).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledWith("Approval denied");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("shows an empty state when there are no pending approvals", async () => {
    const ws = new FakeWsClient();
    ws.approvalList.mockResolvedValueOnce({
      approvals: [],
      next_cursor: undefined,
    });

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

    const approvalsLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="nav-approvals"]',
    );
    expect(approvalsLink).not.toBeNull();

    act(() => {
      approvalsLink?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ws.approvalList).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("No pending approvals");
    expect(container.textContent).toContain(
      "Approvals appear here when agents request permission to perform actions.",
    );

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}
