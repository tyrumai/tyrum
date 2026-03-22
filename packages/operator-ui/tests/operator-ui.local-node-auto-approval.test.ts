// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminAccessController } from "../src/index.js";
import { createFakeHttpClient } from "./operator-ui.test-fixtures.js";
import {
  ACTIVE_EXPIRES_AT,
  createActiveElevatedModeStore,
  createBrowserNodeState,
  createCoreForAutoApproval,
  createDesktopHostApi,
  createInactiveElevatedModeStore,
  createMobileHostApi,
  createMobileState,
  createPairing,
  createReview,
  createWebHost,
  disposeRenderedBridge,
  renderBridge,
  seedPairings,
  waitForMockCallCount,
} from "./operator-ui.local-node-auto-approval.test-support.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { browserNodeStateRef, toastErrorMock, toastWarningMock } = vi.hoisted(() => ({
  browserNodeStateRef: { value: null as Record<string, unknown> | null },
  toastErrorMock: vi.fn(),
  toastWarningMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
    warning: toastWarningMock,
  },
}));

vi.mock("../src/browser-node/browser-node-provider.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/browser-node/browser-node-provider.js")
  >("../src/browser-node/browser-node-provider.js");
  return {
    ...actual,
    useBrowserNodeOptional: () => browserNodeStateRef.value,
  };
});

describe("local node auto approval", () => {
  afterEach(() => {
    browserNodeStateRef.value = null;
    toastErrorMock.mockReset();
    toastWarningMock.mockReset();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("auto-approves the matching desktop node once under StrictMode", async () => {
    const detailedPairing = createPairing({ nodeId: "desktop-node-1" });
    const { http, pairingsList, pairingsGet, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValue({ status: "ok", pairings: [detailedPairing] });
    pairingsGet.mockResolvedValue({ status: "ok", pairing: detailedPairing });
    pairingsApprove.mockResolvedValue({
      status: "ok",
      pairing: { ...detailedPairing, status: "approved", trust_level: "local" },
    });

    const elevatedModeStore = createActiveElevatedModeStore();
    const core = createCoreForAutoApproval({ http, elevatedModeStore });
    await seedPairings(core);

    const { root } = await renderBridge({
      core,
      host: createDesktopHostApi("desktop-node-1"),
      strictMode: true,
    });

    try {
      await waitForMockCallCount(pairingsGet, 1);
      await waitForMockCallCount(pairingsApprove, 1);
      expect(pairingsGet).toHaveBeenCalledTimes(1);
      expect(pairingsApprove).toHaveBeenCalledTimes(1);
      expect(pairingsApprove).toHaveBeenCalledWith(1, {
        trust_level: "local",
        capability_allowlist: detailedPairing.node.capabilities,
        reason: "auto-approved local app node",
      });
    } finally {
      disposeRenderedBridge(root, elevatedModeStore);
    }
  });

  it("does not auto-approve a non-matching node id", async () => {
    const detailedPairing = createPairing({ nodeId: "remote-node-1" });
    const { http, pairingsList, pairingsGet, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValue({ status: "ok", pairings: [detailedPairing] });

    const elevatedModeStore = createActiveElevatedModeStore();
    const core = createCoreForAutoApproval({ http, elevatedModeStore });
    await seedPairings(core);

    const { root } = await renderBridge({
      core,
      host: createDesktopHostApi("desktop-node-3"),
    });

    try {
      expect(pairingsGet).not.toHaveBeenCalled();
      expect(pairingsApprove).not.toHaveBeenCalled();
    } finally {
      disposeRenderedBridge(root, elevatedModeStore);
    }
  });

  it("auto-approves the matching mobile node", async () => {
    const detailedPairing = createPairing({ nodeId: "mobile-node-1" });
    const { http, pairingsList, pairingsGet, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValue({ status: "ok", pairings: [detailedPairing] });
    pairingsGet.mockResolvedValue({ status: "ok", pairing: detailedPairing });
    pairingsApprove.mockResolvedValue({
      status: "ok",
      pairing: { ...detailedPairing, status: "approved", trust_level: "local" },
    });

    const elevatedModeStore = createActiveElevatedModeStore();
    const core = createCoreForAutoApproval({ http, elevatedModeStore });
    await seedPairings(core);

    const { root } = await renderBridge({
      core,
      host: createMobileHostApi(createMobileState({ deviceId: "mobile-node-1" })),
    });

    try {
      await waitForMockCallCount(pairingsGet, 1);
      await waitForMockCallCount(pairingsApprove, 1);
      expect(pairingsGet).toHaveBeenCalledTimes(1);
      expect(pairingsApprove).toHaveBeenCalledTimes(1);
    } finally {
      disposeRenderedBridge(root, elevatedModeStore);
    }
  });

  it("auto-approves the matching browser node", async () => {
    const detailedPairing = createPairing({ nodeId: "browser-node-1" });
    const { http, pairingsList, pairingsGet, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValue({ status: "ok", pairings: [detailedPairing] });
    pairingsGet.mockResolvedValue({ status: "ok", pairing: detailedPairing });
    pairingsApprove.mockResolvedValue({
      status: "ok",
      pairing: { ...detailedPairing, status: "approved", trust_level: "local" },
    });

    browserNodeStateRef.value = createBrowserNodeState("browser-node-1");

    const elevatedModeStore = createActiveElevatedModeStore();
    const core = createCoreForAutoApproval({ http, elevatedModeStore });
    await seedPairings(core);
    const initialRefreshCalls = pairingsList.mock.calls.length;

    const { root } = await renderBridge({
      core,
      host: createWebHost(),
    });

    try {
      await waitForMockCallCount(pairingsGet, 1);
      await waitForMockCallCount(pairingsApprove, 1);
      expect(pairingsList).toHaveBeenCalledTimes(initialRefreshCalls);
      expect(pairingsGet).toHaveBeenCalledTimes(1);
      expect(pairingsApprove).toHaveBeenCalledTimes(1);
    } finally {
      disposeRenderedBridge(root, elevatedModeStore);
    }
  });

  it("refreshes pairings once the browser node becomes eligible after mount", async () => {
    const detailedPairing = createPairing({ nodeId: "browser-node-2" });
    const { http, pairingsList, pairingsGet, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [] }).mockResolvedValue({
      status: "ok",
      pairings: [detailedPairing],
    });
    pairingsGet.mockResolvedValue({ status: "ok", pairing: detailedPairing });
    pairingsApprove.mockResolvedValue({
      status: "ok",
      pairing: { ...detailedPairing, status: "approved", trust_level: "local" },
    });

    const elevatedModeStore = createActiveElevatedModeStore();
    const core = createCoreForAutoApproval({ http, elevatedModeStore });
    await seedPairings(core);
    const initialRefreshCalls = pairingsList.mock.calls.length;

    const { rerender, root } = await renderBridge({
      core,
      host: createWebHost(),
    });

    try {
      expect(pairingsList).toHaveBeenCalledTimes(initialRefreshCalls);
      browserNodeStateRef.value = createBrowserNodeState("browser-node-2");
      await rerender();

      await waitForMockCallCount(pairingsList, initialRefreshCalls + 1);
      await waitForMockCallCount(pairingsGet, 1);
      await waitForMockCallCount(pairingsApprove, 1);
      expect(pairingsList).toHaveBeenCalledTimes(initialRefreshCalls + 1);
      expect(pairingsApprove).toHaveBeenCalledTimes(1);
    } finally {
      disposeRenderedBridge(root, elevatedModeStore);
    }
  });

  it("does not refresh pairings again when the matching browser pairing is already known", async () => {
    const detailedPairing = createPairing({ nodeId: "browser-node-3" });
    const { http, pairingsList, pairingsGet, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValue({ status: "ok", pairings: [detailedPairing] });
    pairingsGet.mockResolvedValue({ status: "ok", pairing: detailedPairing });
    pairingsApprove.mockResolvedValue({
      status: "ok",
      pairing: { ...detailedPairing, status: "approved", trust_level: "local" },
    });

    browserNodeStateRef.value = createBrowserNodeState("browser-node-3");

    const elevatedModeStore = createActiveElevatedModeStore();
    const core = createCoreForAutoApproval({ http, elevatedModeStore });
    await seedPairings(core);
    const initialRefreshCalls = pairingsList.mock.calls.length;

    const { root } = await renderBridge({
      core,
      host: createWebHost(),
    });

    try {
      await waitForMockCallCount(pairingsGet, 1);
      await waitForMockCallCount(pairingsApprove, 1);
      expect(pairingsList).toHaveBeenCalledTimes(initialRefreshCalls);
      expect(pairingsApprove).toHaveBeenCalledTimes(1);
    } finally {
      disposeRenderedBridge(root, elevatedModeStore);
    }
  });

  it("refreshes and auto-approves the matching browser node only once under StrictMode", async () => {
    const detailedPairing = createPairing({ nodeId: "browser-node-4" });
    const { http, pairingsList, pairingsGet, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [] }).mockResolvedValue({
      status: "ok",
      pairings: [detailedPairing],
    });
    pairingsGet.mockResolvedValue({ status: "ok", pairing: detailedPairing });
    pairingsApprove.mockResolvedValue({
      status: "ok",
      pairing: { ...detailedPairing, status: "approved", trust_level: "local" },
    });

    browserNodeStateRef.value = createBrowserNodeState("browser-node-4");

    const elevatedModeStore = createActiveElevatedModeStore();
    const core = createCoreForAutoApproval({ http, elevatedModeStore });
    await seedPairings(core);
    const initialRefreshCalls = pairingsList.mock.calls.length;

    const { root } = await renderBridge({
      core,
      host: createWebHost(),
      strictMode: true,
    });

    try {
      await waitForMockCallCount(pairingsList, initialRefreshCalls + 1);
      await waitForMockCallCount(pairingsGet, 1);
      await waitForMockCallCount(pairingsApprove, 1);
      expect(pairingsList).toHaveBeenCalledTimes(initialRefreshCalls + 1);
      expect(pairingsGet).toHaveBeenCalledTimes(1);
      expect(pairingsApprove).toHaveBeenCalledTimes(1);
    } finally {
      disposeRenderedBridge(root, elevatedModeStore);
    }
  });

  it("enters elevated mode automatically before approving the local node", async () => {
    const detailedPairing = createPairing({ nodeId: "desktop-node-2" });
    const { http, pairingsList, pairingsGet, pairingsApprove } = createFakeHttpClient();
    pairingsList.mockResolvedValue({ status: "ok", pairings: [detailedPairing] });
    pairingsGet.mockResolvedValue({ status: "ok", pairing: detailedPairing });
    pairingsApprove.mockResolvedValue({
      status: "ok",
      pairing: { ...detailedPairing, status: "approved", trust_level: "local" },
    });

    const elevatedModeStore = createInactiveElevatedModeStore();
    const core = createCoreForAutoApproval({ http, elevatedModeStore });
    await seedPairings(core);

    const controller: AdminAccessController = {
      enter: vi.fn(async () => {
        elevatedModeStore.enter({
          elevatedToken: "fresh-elevated-token",
          expiresAt: ACTIVE_EXPIRES_AT,
        });
      }),
      exit: vi.fn(async () => {
        elevatedModeStore.exit();
      }),
    };

    const { root } = await renderBridge({
      core,
      host: createDesktopHostApi("desktop-node-2"),
      controller,
    });

    try {
      await waitForMockCallCount(pairingsApprove, 1);
      expect(controller.enter).toHaveBeenCalledTimes(1);
      expect(pairingsApprove).toHaveBeenCalledTimes(1);
    } finally {
      disposeRenderedBridge(root, elevatedModeStore);
    }
  });

  it.each(["denied", "revoked"] as const)(
    "does not auto-approve when the latest terminal review is %s",
    async (terminalState) => {
      const reviews = [
        createReview(terminalState, "2026-01-01T00:00:01.000Z"),
        createReview("requested_human", "2026-01-01T00:00:02.000Z", `pending-${terminalState}`),
      ];
      const detailedPairing = createPairing({
        nodeId: "mobile-node-2",
        latestReview: reviews[1] ?? null,
        reviews,
      });
      const { http, pairingsList, pairingsGet, pairingsApprove } = createFakeHttpClient();
      pairingsList.mockResolvedValue({ status: "ok", pairings: [detailedPairing] });
      pairingsGet.mockResolvedValue({ status: "ok", pairing: detailedPairing });

      const elevatedModeStore = createActiveElevatedModeStore();
      const core = createCoreForAutoApproval({ http, elevatedModeStore });
      await seedPairings(core);

      const { root } = await renderBridge({
        core,
        host: createMobileHostApi(
          createMobileState({ deviceId: "mobile-node-2", platform: "android" }),
        ),
      });

      try {
        await waitForMockCallCount(pairingsGet, 1);
        expect(pairingsGet).toHaveBeenCalledTimes(1);
        expect(pairingsApprove).not.toHaveBeenCalled();
      } finally {
        disposeRenderedBridge(root, elevatedModeStore);
      }
    },
  );
});
