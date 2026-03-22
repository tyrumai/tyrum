import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PairingGetResponse } from "@tyrum/operator-app/browser";
import {
  createBearerTokenAuth,
  createElevatedModeStore,
  createOperatorCore,
  isElevatedModeActive,
  type ElevatedModeStore,
  type OperatorCore,
} from "../../operator-app/src/index.js";
import {
  AdminAccessProvider,
  OperatorUiHostProvider,
  type AdminAccessController,
  type MobileHostApi,
  type MobileHostState,
  type OperatorUiHostApi,
} from "../src/index.js";
import { LocalNodeAutoApprovalBridge } from "../src/local-node-auto-approval.js";
import { FakeWsClient } from "./operator-ui.test-fixtures.js";
import { vi } from "vitest";

type PairingReview = NonNullable<PairingGetResponse["pairing"]["reviews"]>[number];

const CAPABILITIES = [{ id: "tyrum.http", version: "1.0.0" }] as const;

export const ACTIVE_ENTERED_AT = "2026-01-01T00:00:00.000Z";
export const ACTIVE_EXPIRES_AT = "2026-01-01T00:10:00.000Z";

export function createReview(
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

export function createPairing(input?: {
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

export function createDesktopHostApi(deviceId: string): OperatorUiHostApi {
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

export function createMobileHostApi(state: MobileHostState): OperatorUiHostApi {
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

export function createWebHost(): OperatorUiHostApi {
  return { kind: "web" };
}

export function createBrowserNodeState(deviceId: string): Record<string, unknown> {
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

export function createMobileState(input: {
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
      get: {
        enabled: true,
        availabilityStatus: "ready",
        unavailableReason: null,
      },
      capture_photo: {
        enabled: true,
        availabilityStatus: "ready",
        unavailableReason: null,
      },
      record: {
        enabled: true,
        availabilityStatus: "ready",
        unavailableReason: null,
      },
    },
  };
}

type OperatorCoreHttp = Parameters<typeof createOperatorCore>[0]["deps"]["http"];

export function createCoreForAutoApproval(input: {
  http: OperatorCoreHttp;
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

export function createActiveElevatedModeStore(): ElevatedModeStore {
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

export function createInactiveElevatedModeStore(): ElevatedModeStore {
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
    await new Promise((done) => {
      globalThis.setTimeout(done, 0);
    });
  });
}

export async function waitForMockCallCount(
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

export async function renderBridge(input: {
  core: OperatorCore;
  host: OperatorUiHostApi;
  controller?: AdminAccessController;
  strictMode?: boolean;
}): Promise<{ rerender: () => Promise<void>; root: Root }> {
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
  return { root, rerender: renderTree };
}

export function disposeRenderedBridge(root: Root, elevatedModeStore: ElevatedModeStore): void {
  act(() => root.unmount());
  elevatedModeStore.dispose();
}

export async function seedPairings(core: OperatorCore): Promise<void> {
  await act(async () => await core.pairingStore.refresh());
}
