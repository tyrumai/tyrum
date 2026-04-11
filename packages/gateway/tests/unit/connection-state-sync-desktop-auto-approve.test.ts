import { afterEach, describe, expect, it, vi } from "vitest";

const {
  resolveAutoReviewModeMock,
  initializePairingReviewMock,
  emitPairingApprovedEventMock,
  broadcastWsEventMock,
  ensurePairingResolvedEventMock,
} = vi.hoisted(() => ({
  resolveAutoReviewModeMock: vi.fn(async () => "auto_review"),
  initializePairingReviewMock: vi.fn(async (_input: unknown) => undefined),
  emitPairingApprovedEventMock: vi.fn(),
  broadcastWsEventMock: vi.fn(),
  ensurePairingResolvedEventMock: vi.fn(async () => ({
    event: {
      event_id: "evt-1",
      type: "pairing.updated",
      occurred_at: "2026-03-18T00:00:00Z",
      payload: {},
    },
  })),
}));

vi.mock("../../src/modules/review/review-init.js", () => ({
  resolveAutoReviewMode: resolveAutoReviewModeMock,
  pairingStatusForReviewMode: (mode: string) =>
    mode === "manual_only" ? "awaiting_human" : "queued",
  initializePairingReview: initializePairingReviewMock,
}));

vi.mock("../../src/ws/pairing-approved.js", () => ({
  emitPairingApprovedEvent: emitPairingApprovedEventMock,
}));

vi.mock("../../src/ws/broadcast.js", () => ({
  broadcastWsEvent: broadcastWsEventMock,
}));

vi.mock("../../src/ws/stable-events.js", () => ({
  ensurePairingResolvedEvent: ensurePairingResolvedEventMock,
}));

import { syncConnectionEstablished } from "../../src/routes/ws/connection-state-sync.js";

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

function createMinimalDeps(overrides?: {
  desktopEnvironmentDal?: unknown;
  nodePairingDal?: unknown;
  presenceDal?: unknown;
  connectionManager?: unknown;
}) {
  const connectionManager = overrides?.connectionManager ?? { allClients: () => [] };
  const nodePairingDal = overrides?.nodePairingDal ?? {
    getByNodeId: vi.fn(async () => null),
    upsertOnConnect: vi.fn(async () => ({ pairing_id: 1, status: "queued" })),
    resolve: vi.fn(async () => undefined),
  };
  return {
    connectionManager: connectionManager as never,
    protocolDeps: {
      policyService: undefined,
      logger: { warn: vi.fn() },
      wsEventDal: undefined,
      maxBufferedBytes: undefined,
      cluster: undefined,
    } as never,
    cluster: undefined,
    connectionTtlMs: 30_000,
    presenceDal: overrides?.presenceDal as never,
    nodePairingDal: nodePairingDal as never,
    desktopEnvironmentDal: overrides?.desktopEnvironmentDal as never,
    presenceTtlMs: 60_000,
  };
}

function createPendingInit(overrides?: Partial<Record<string, unknown>>) {
  return {
    protocolRev: 2,
    role: "node" as const,
    deviceId: "device-desktop-1",
    pubkey: "pubkey-1",
    label: "Desktop Sandbox",
    platform: "linux",
    version: "0.1.0",
    mode: "desktop-sandbox",
    capabilities: [],
    connectionId: "conn-1",
    challenge: "challenge-1",
    ...overrides,
  };
}

describe("initializePairingOnConnect desktop auto-approve", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("auto-approves a managed desktop environment pairing at connect time", async () => {
    const resolvedPairing = {
      pairing_id: 1,
      status: "approved",
      node: { node_id: "device-desktop-1" },
    };
    const nodePairingDal = {
      getByNodeId: vi.fn(async () => null),
      upsertOnConnect: vi.fn(async () => ({ pairing_id: 1, status: "queued" })),
      resolve: vi.fn(async () => ({
        pairing: resolvedPairing,
        transitioned: true,
        scopedToken: "scoped-token-abc",
      })),
    };
    const desktopEnvironmentDal = {
      getByNodeId: vi.fn(async () => ({
        environment_id: "env-1",
        tenant_id: "tenant-1",
        desired_running: true,
      })),
      listByNodeIds: vi.fn(async () => [
        {
          environment_id: "env-1",
          tenant_id: "tenant-1",
          node_id: "device-desktop-1",
        },
      ]),
    };
    initializePairingReviewMock.mockResolvedValue({
      pairing_id: 1,
      status: "queued",
    });

    const deps = createMinimalDeps({ nodePairingDal, desktopEnvironmentDal });

    syncConnectionEstablished({
      deps,
      pending: createPendingInit(),
      claims: { tenant_id: "tenant-1" } as never,
      clientId: "client-1",
      deviceId: "device-desktop-1",
      clientIp: { rawRemoteIp: "127.0.0.1", resolvedClientIp: "127.0.0.1" },
    });

    await flushAsync();

    expect(desktopEnvironmentDal.getByNodeId).toHaveBeenCalledWith("device-desktop-1", "tenant-1");
    expect(desktopEnvironmentDal.listByNodeIds).toHaveBeenCalledTimes(1);
    expect(nodePairingDal.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        pairingId: 1,
        decision: "approved",
        trustLevel: "local",
        reason: "gateway-managed desktop environment",
        allowedCurrentStatuses: ["queued", "reviewing", "awaiting_human"],
      }),
    );
    expect(emitPairingApprovedEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ connectionManager: deps.connectionManager }),
      "tenant-1",
      expect.objectContaining({
        pairing: expect.objectContaining({
          node: expect.objectContaining({
            managed_desktop: {
              environment_id: "env-1",
            },
          }),
        }),
        nodeId: "device-desktop-1",
        scopedToken: "scoped-token-abc",
      }),
    );
    expect(ensurePairingResolvedEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        pairing: expect.objectContaining({
          node: expect.objectContaining({
            managed_desktop: {
              environment_id: "env-1",
            },
          }),
        }),
      }),
    );
  });

  it("falls through to normal review flow when node is not a managed environment", async () => {
    const nodePairingDal = {
      getByNodeId: vi.fn(async () => null),
      upsertOnConnect: vi.fn(async () => ({ pairing_id: 2, status: "queued" })),
      resolve: vi.fn(),
    };
    const desktopEnvironmentDal = {
      getByNodeId: vi.fn(async () => undefined),
      listByNodeIds: vi.fn(async () => []),
    };
    initializePairingReviewMock.mockResolvedValue({
      pairing_id: 2,
      status: "queued",
    });

    const deps = createMinimalDeps({ nodePairingDal, desktopEnvironmentDal });

    syncConnectionEstablished({
      deps,
      pending: createPendingInit({ deviceId: "device-unknown" }),
      claims: { tenant_id: "tenant-1" } as never,
      clientId: "client-2",
      deviceId: "device-unknown",
      clientIp: { rawRemoteIp: "127.0.0.1", resolvedClientIp: "127.0.0.1" },
    });

    await flushAsync();

    expect(desktopEnvironmentDal.getByNodeId).toHaveBeenCalledWith("device-unknown", "tenant-1");
    expect(nodePairingDal.resolve).not.toHaveBeenCalled();
    expect(emitPairingApprovedEventMock).not.toHaveBeenCalled();
  });

  it("skips auto-approve when desktopEnvironmentDal is not provided", async () => {
    const nodePairingDal = {
      getByNodeId: vi.fn(async () => null),
      upsertOnConnect: vi.fn(async () => ({ pairing_id: 3, status: "queued" })),
      resolve: vi.fn(),
    };
    initializePairingReviewMock.mockResolvedValue({
      pairing_id: 3,
      status: "queued",
    });

    const deps = createMinimalDeps({ nodePairingDal });

    syncConnectionEstablished({
      deps,
      pending: createPendingInit(),
      claims: { tenant_id: "tenant-1" } as never,
      clientId: "client-3",
      deviceId: "device-desktop-1",
      clientIp: { rawRemoteIp: "127.0.0.1", resolvedClientIp: "127.0.0.1" },
    });

    await flushAsync();

    expect(nodePairingDal.resolve).not.toHaveBeenCalled();
    expect(emitPairingApprovedEventMock).not.toHaveBeenCalled();
  });

  it("broadcasts presence.upserted only to clients in the same tenant", async () => {
    const sameTenantClientSend = vi.fn();
    const sameTenantNodeSend = vi.fn();
    const otherTenantClientSend = vi.fn();
    const connectionManager = {
      allClients: () => [
        {
          id: "conn-client-1",
          role: "client",
          auth_claims: { tenant_id: "tenant-1", token_kind: "admin", scopes: ["*"] },
          ws: { send: sameTenantClientSend },
        },
        {
          id: "conn-node-1",
          role: "node",
          auth_claims: {
            tenant_id: "tenant-1",
            token_kind: "device",
            scopes: [],
          },
          ws: { send: sameTenantNodeSend },
        },
        {
          id: "conn-client-2",
          role: "client",
          auth_claims: { tenant_id: "tenant-2" },
          ws: { send: otherTenantClientSend },
        },
      ],
    };
    const presenceDal = {
      upsert: vi.fn(async () => ({
        tenant_id: "tenant-1",
        instance_id: "device-tenant-1",
        role: "client" as const,
        connection_id: "conn-1",
        host: "Desktop Sandbox",
        ip: "127.0.0.1",
        version: "0.1.0",
        mode: "desktop-sandbox",
        last_input_seconds: null,
        metadata: { capabilities: [] },
        connected_at_ms: 1,
        last_seen_at_ms: 1,
        expires_at_ms: 60_001,
      })),
    };

    const deps = createMinimalDeps({
      connectionManager,
      presenceDal,
      nodePairingDal: {
        getByNodeId: vi.fn(async () => null),
        upsertOnConnect: vi.fn(),
        resolve: vi.fn(),
      },
    });

    syncConnectionEstablished({
      deps,
      pending: createPendingInit({ role: "client", deviceId: "device-tenant-1" }),
      claims: { tenant_id: "tenant-1" } as never,
      clientId: "conn-1",
      deviceId: "device-tenant-1",
      clientIp: { rawRemoteIp: "127.0.0.1", resolvedClientIp: "127.0.0.1" },
    });

    await flushAsync();

    expect(presenceDal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        instanceId: "device-tenant-1",
        connectionId: "conn-1",
      }),
    );
    expect(sameTenantClientSend).toHaveBeenCalledOnce();
    expect(sameTenantNodeSend).not.toHaveBeenCalled();
    expect(otherTenantClientSend).not.toHaveBeenCalled();
  });
});
