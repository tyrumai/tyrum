// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { PairingGetResponse } from "@tyrum/client/browser";
import {
  createBearerTokenAuth,
  createElevatedModeStore,
  createOperatorCore,
  isElevatedModeActive,
  type ElevatedModeStore,
  type OperatorCore,
} from "../../operator-core/src/index.js";
import {
  AdminAccessProvider,
  OperatorUiHostProvider,
  type AdminAccessController,
  type MobileHostApi,
  type MobileHostState,
  type OperatorUiHostApi,
} from "../src/index.js";
import { LocalNodeAutoApprovalBridge } from "../src/local-node-auto-approval.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

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

type PairingReview = NonNullable<PairingGetResponse["pairing"]["reviews"]>[number];

const CAPABILITIES = [{ id: "tyrum.http", version: "1.0.0" }] as const;
const ACTIVE_ENTERED_AT = "2026-01-01T00:00:00.000Z",
  ACTIVE_EXPIRES_AT = "2026-01-01T00:10:00.000Z";

function createReview(
  state: PairingReview["state"],
  createdAt: string,
  reviewId = `${state}-${createdAt}`,
): PairingReview {
  return {
    review_id: reviewId,
    target_type: "pairing",
    target_id: "1",
    reviewer_kind: state === "requested_human" ? "system" : "human",
    reviewer_id: null,
    state,
    reason: state,
    risk_level: null,
    risk_score: null,
    evidence: null,
    decision_payload: null,
    created_at: createdAt,
    started_at: createdAt,
    completed_at: state === "requested_human" ? null : createdAt,
  };
}

function createPairing(input?: {
  pairingId?: number;
  nodeId?: string;
  requestedAt?: string;
  status?: PairingGetResponse["pairing"]["status"];
  capabilities?: PairingGetResponse["pairing"]["node"]["capabilities"];
  latestReview?: PairingGetResponse["pairing"]["latest_review"];
  reviews?: PairingReview[];
}): PairingGetResponse["pairing"] {
  const pairingId = input?.pairingId ?? 1;
  const requestedAt = input?.requestedAt ?? "2026-01-01T00:00:00.000Z";
  return {
    pairing_id: pairingId,
    status: input?.status ?? "awaiting_human",
    motivation: "Local node requested pairing.",
    trust_level: undefined,
    requested_at: requestedAt,
    node: {
      node_id: input?.nodeId ?? "local-node-1",
      label: "Local node",
      last_seen_at: requestedAt,
      capabilities: [...(input?.capabilities ?? CAPABILITIES)],
      metadata: { mode: "local-node" },
    },
    capability_allowlist: [],
    latest_review: input?.latestReview ?? null,
    ...(input?.reviews ? { reviews: input.reviews } : {}),
  };
}

function createDesktopHostApi(deviceId: string): OperatorUiHostApi {
  return {
    kind: "desktop",
    api: {
      getConfig: async () => ({}),
      setConfig: async () => ({}),
      gateway: {
        getStatus: async () => ({ status: "ok", port: 8788 }),
        start: async () => ({ status: "ok", port: 8788 }),
        stop: async () => ({ status: "ok" }),
      },
      node: {
        connect: async () => ({ status: "connecting" }),
        disconnect: async () => ({ status: "disconnected" }),
        getStatus: async () => ({ status: "connected", connected: true, deviceId }),
      },
      onStatusChange: () => () => {},
    },
  };
}

function createMobileHostApi(state: MobileHostState): OperatorUiHostApi {
  const api: MobileHostApi = {
    node: {
      getState: vi.fn(async () => state),
      setEnabled: vi.fn(async () => state),
      setActionEnabled: vi.fn(async () => state),
    },
    onStateChange: vi.fn((_cb: (nextState: MobileHostState) => void) => () => {}),
  };
  return { kind: "mobile", api };
}

function createWebHost(): OperatorUiHostApi {
  return { kind: "web" };
}

function createBrowserNodeState(deviceId: string): Record<string, unknown> {
  return {
    enabled: true,
    status: "connected",
    deviceId,
    clientId: "browser-client-1",
    error: null,
    capabilityStates: {},
    setEnabled: vi.fn(),
    setCapabilityEnabled: vi.fn(),
    executeLocal: vi.fn(async () => ({ success: true })),
  };
}

function createMobileState(input: {
  deviceId: string;
  platform?: MobileHostState["platform"];
  enabled?: boolean;
  status?: MobileHostState["status"];
}): MobileHostState {
  return {
    platform: input.platform ?? "ios",
    enabled: input.enabled ?? true,
    status: input.status ?? "connected",
    deviceId: input.deviceId,
    error: null,
    actions: {
      "location.get_current": {
        enabled: true,
        availabilityStatus: "ready",
        unavailableReason: null,
      },
      "camera.capture_photo": {
        enabled: true,
        availabilityStatus: "ready",
        unavailableReason: null,
      },
      "audio.record_clip": {
        enabled: true,
        availabilityStatus: "ready",
        unavailableReason: null,
      },
    },
  };
}

function createCoreForAutoApproval(input: {
  http: ReturnType<typeof createFakeHttpClient>["http"];
  elevatedModeStore: ElevatedModeStore;
}): OperatorCore {
  const ws = new FakeWsClient(true);
  return createOperatorCore({
    wsUrl: "ws://example.test/ws",
    httpBaseUrl: "http://example.test",
    auth: createBearerTokenAuth("test"),
    elevatedModeStore: input.elevatedModeStore,
    deps: {
      ws,
      http: input.http,
      createPrivilegedWs: () => ws,
      createPrivilegedHttp: () =>
        isElevatedModeActive(input.elevatedModeStore.getSnapshot()) ? input.http : null,
    },
  });
}

function createActiveElevatedModeStore(): ElevatedModeStore {
  const elevatedModeStore = createElevatedModeStore({
    tickIntervalMs: 0,
    now: () => Date.parse(ACTIVE_ENTERED_AT),
  });
  elevatedModeStore.enter({
    elevatedToken: "test-elevated-token",
    expiresAt: ACTIVE_EXPIRES_AT,
  });
  return elevatedModeStore;
}

function createInactiveElevatedModeStore(): ElevatedModeStore {
  return createElevatedModeStore({
    tickIntervalMs: 0,
    now: () => Date.parse(ACTIVE_ENTERED_AT),
  });
}

async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 12; index += 1) {
      await Promise.resolve();
    }
    await new Promise((resolve) => {
      globalThis.setTimeout(resolve, 0);
    });
  });
}

async function waitForMockCallCount(
  mock: ReturnType<typeof vi.fn>,
  expectedCalls: number,
): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    if (mock.mock.calls.length >= expectedCalls) {
      return;
    }
    await flushAsyncWork();
  }
}

async function renderBridge(input: {
  core: OperatorCore;
  host: OperatorUiHostApi;
  controller?: AdminAccessController;
  strictMode?: boolean;
}): Promise<{ root: Root }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const renderTree = async (): Promise<void> => {
    const tree = React.createElement(
      OperatorUiHostProvider,
      { value: input.host },
      React.createElement(
        AdminAccessProvider,
        {
          core: input.core,
          mode: input.host.kind === "desktop" ? "desktop" : "web",
          adminAccessController: input.controller,
        },
        React.createElement(LocalNodeAutoApprovalBridge),
      ),
    );
    await act(async () => {
      root.render(input.strictMode ? React.createElement(React.StrictMode, null, tree) : tree);
    });
    await flushAsyncWork();
  };

  await renderTree();
  return { root };
}

function disposeRenderedBridge(root: Root, elevatedModeStore: ElevatedModeStore): void {
  act(() => root.unmount());
  elevatedModeStore.dispose();
}

async function seedPairings(core: OperatorCore): Promise<void> {
  await act(async () => await core.pairingStore.refresh());
}

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

    const { root } = await renderBridge({
      core,
      host: createWebHost(),
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
