import type { NodePairingRequest } from "@tyrum/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  broadcastWsEventMock,
  ensurePairingResolvedEventMock,
  enrichApprovalWithManagedDesktopMock,
  enrichPairingWithManagedDesktopMock,
} = vi.hoisted(() => ({
  broadcastWsEventMock: vi.fn(),
  ensurePairingResolvedEventMock: vi.fn(async (input: { pairing: NodePairingRequest }) => ({
    event: {
      event_id: "evt-1",
      type: "pairing.updated" as const,
      occurred_at: input.pairing.requested_at,
      payload: { pairing: input.pairing },
    },
  })),
  enrichApprovalWithManagedDesktopMock: vi.fn(),
  enrichPairingWithManagedDesktopMock: vi.fn(),
}));

vi.mock("../../src/ws/broadcast.js", () => ({
  broadcastWsEvent: broadcastWsEventMock,
}));

vi.mock("../../src/ws/stable-events.js", () => ({
  ensurePairingResolvedEvent: ensurePairingResolvedEventMock,
}));

vi.mock("../../src/modules/desktop-environments/managed-desktop-reference.js", () => ({
  enrichApprovalWithManagedDesktop: enrichApprovalWithManagedDesktopMock,
  enrichPairingWithManagedDesktop: enrichPairingWithManagedDesktopMock,
}));

import { emitPairingUpdate } from "../../src/modules/review/guardian-review-processor-support.js";

function createPairing(): NodePairingRequest {
  return {
    pairing_id: 1,
    status: "approved",
    motivation: "desktop pairing",
    trust_level: "local",
    requested_at: "2026-03-25T08:00:00.000Z",
    node: {
      node_id: "node-1",
      label: "Desktop node",
      capabilities: [],
      last_seen_at: "2026-03-25T08:00:00.000Z",
    },
    capability_allowlist: [],
    latest_review: null,
  };
}

function createDeps() {
  return {
    container: { db: {} } as never,
    ws: {
      connectionManager: {} as never,
      cluster: undefined,
      maxBufferedBytes: undefined,
    },
    wsEventDal: undefined,
    logger: undefined,
  };
}

describe("emitPairingUpdate", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reuses an already enriched managed desktop pairing", async () => {
    const pairing: NodePairingRequest = {
      ...createPairing(),
      node: {
        ...createPairing().node,
        managed_desktop: {
          environment_id: "env-1",
        },
      },
    };

    await emitPairingUpdate({
      tenantId: "tenant-1",
      pairing,
      deps: createDeps(),
      scopedToken: "scoped-token-1",
    });

    expect(enrichPairingWithManagedDesktopMock).not.toHaveBeenCalled();
    expect(ensurePairingResolvedEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        pairing,
        scopedToken: "scoped-token-1",
      }),
    );
  });

  it("enriches pairings that do not already carry a managed desktop reference", async () => {
    const pairing = createPairing();
    const enrichedPairing: NodePairingRequest = {
      ...pairing,
      node: {
        ...pairing.node,
        managed_desktop: {
          environment_id: "env-1",
        },
      },
    };
    enrichPairingWithManagedDesktopMock.mockResolvedValue(enrichedPairing);

    await emitPairingUpdate({
      tenantId: "tenant-1",
      pairing,
      deps: createDeps(),
    });

    expect(enrichPairingWithManagedDesktopMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        pairing,
      }),
    );
    expect(ensurePairingResolvedEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        pairing: enrichedPairing,
      }),
    );
  });
});
