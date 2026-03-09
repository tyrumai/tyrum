import { expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { PairingPage } from "../src/components/pages/pairing-page.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";
import { sampleNodeInventoryResponse } from "./operator-ui.http-fixture-data.js";
import { TEST_DEVICE_IDENTITY } from "./operator-ui.test-support.js";

export function registerPairingNodeInventoryTests(): void {
  it("requests node inventory for the active chat lane and highlights the attached local node", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, nodesList } = createFakeHttpClient();
    const sampleInventory = sampleNodeInventoryResponse();
    pairingsList.mockResolvedValueOnce({
      status: "ok",
      pairings: [
        {
          pairing_id: 1,
          status: "approved",
          requested_at: "2026-01-01T00:00:00.000Z",
          node: {
            node_id: "node-1",
            label: "my takeover: label (takeover: http://localhost:6080/vnc.html?autoconnect=true)",
            last_seen_at: "2026-01-01T00:00:00.000Z",
            capabilities: [],
          },
          capability_allowlist: [
            { id: "tyrum.cli", version: "1.0.0" },
            { id: "tyrum.http", version: "1.0.0" },
          ],
          trust_level: "local",
          resolution: {
            decision: "approved",
            resolved_at: "2026-01-01T00:00:01.000Z",
            reason: "ok",
          },
          resolved_at: "2026-01-01T00:00:01.000Z",
        },
      ],
    });
    nodesList.mockResolvedValueOnce({
      ...sampleInventory,
      key: "agent:default:ui:default:channel:ui-session-1",
      lane: "main",
      nodes: [
        {
          ...sampleInventory.nodes[0],
          connected: true,
          attached_to_requested_lane: true,
          source_client_device_id: TEST_DEVICE_IDENTITY.deviceId,
        },
      ],
    });

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });

    act(() => {
      core.connect();
    });
    await act(async () => {
      await core.chatStore.openSession("session-1");
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

    expect(nodesList).toHaveBeenCalledWith({
      dispatchable_only: false,
      key: "agent:default:ui:default:channel:ui-session-1",
      lane: "main",
    });
    expect(container.querySelector('[data-testid="pairing-attached-local-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pairing-attached-lane-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="pairing-connection-1"]')?.textContent).toContain(
      "Connected",
    );
    expect(container.querySelector('[data-testid="pairing-card-1"]')?.className ?? "").toContain(
      "border-primary/40",
    );

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("shows a neutral lane badge when another client attached the node", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, nodesList } = createFakeHttpClient();
    const sampleInventory = sampleNodeInventoryResponse();
    pairingsList.mockResolvedValueOnce({
      status: "ok",
      pairings: [
        {
          pairing_id: 1,
          status: "approved",
          requested_at: "2026-01-01T00:00:00.000Z",
          node: {
            node_id: "node-1",
            label: "my takeover: label (takeover: http://localhost:6080/vnc.html?autoconnect=true)",
            last_seen_at: "2026-01-01T00:00:00.000Z",
            capabilities: [],
          },
          capability_allowlist: [
            { id: "tyrum.cli", version: "1.0.0" },
            { id: "tyrum.http", version: "1.0.0" },
          ],
          trust_level: "local",
          resolution: {
            decision: "approved",
            resolved_at: "2026-01-01T00:00:01.000Z",
            reason: "ok",
          },
          resolved_at: "2026-01-01T00:00:01.000Z",
        },
      ],
    });
    nodesList.mockResolvedValueOnce({
      ...sampleInventory,
      key: "agent:default:ui:default:channel:ui-session-1",
      lane: "main",
      nodes: [
        {
          ...sampleInventory.nodes[0],
          attached_to_requested_lane: true,
          source_client_device_id: "dev_other_client",
        },
      ],
    });

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deviceIdentity: TEST_DEVICE_IDENTITY,
      deps: { ws, http },
    });

    act(() => {
      core.connect();
    });
    await act(async () => {
      await core.chatStore.openSession("session-1");
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

    expect(container.querySelector('[data-testid="pairing-attached-local-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="pairing-attached-lane-1"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="pairing-card-1"]')?.className ?? "",
    ).not.toContain("border-primary/40");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}
