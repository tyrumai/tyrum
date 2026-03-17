import { expect, it } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-core/src/index.js";
import { AdminAccessProvider } from "../src/index.js";
import { PairingPage } from "../src/components/pages/pairing-page.js";
import { sampleNodeInventoryResponse } from "./operator-ui.data-fixtures.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";
import { TEST_DEVICE_IDENTITY } from "./operator-ui.test-support.js";

const NOOP_ADMIN_ACCESS_CONTROLLER = {
  enter: async () => {},
  exit: async () => {},
};

function renderPairingPage(root: Root, core: Parameters<typeof PairingPage>[0]["core"]): void {
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
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function expandNodeRow(container: HTMLElement, nodeId: string): void {
  const toggle = container.querySelector<HTMLButtonElement>(
    `[data-testid="pairing-row-toggle-${nodeId}"]`,
  );
  expect(toggle).not.toBeNull();
  act(() => {
    toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function sampleCapabilitySummary(capability: string) {
  return {
    capability,
    capability_version: "1.0.0",
    connected: true,
    paired: false,
    dispatchable: false,
    supported_action_count: 1,
    enabled_action_count: 1,
    available_action_count: 1,
    unknown_action_count: 0,
  } as const;
}

export function registerPairingNodeInventoryTests(): void {
  it("requests node inventory for the active chat lane and highlights the attached local node", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, nodesList } = createFakeHttpClient();
    const sampleInventory = sampleNodeInventoryResponse();
    pairingsList.mockResolvedValue({
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
      renderPairingPage(root, core);
    });

    await act(async () => {
      await flushPairingPage();
    });

    expect(nodesList).toHaveBeenCalledWith({
      dispatchable_only: false,
      key: "agent:default:ui:default:channel:ui-session-1",
      lane: "main",
    });

    expandNodeRow(container, "node-1");
    expect(container.querySelector('[data-testid="pairing-attached-local-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="pairing-attached-lane-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="pairing-connection-1"]')?.textContent).toContain(
      "Connected",
    );
    expect(
      container.querySelector('[data-testid="pairing-row-toggle-node-1"]')?.className ?? "",
    ).toContain("bg-primary/5");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("shows a neutral lane badge when another client attached the node", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, nodesList } = createFakeHttpClient();
    const sampleInventory = sampleNodeInventoryResponse();
    pairingsList.mockResolvedValue({
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
    nodesList.mockResolvedValue({
      ...sampleInventory,
      key: "agent:default:ui:default:channel:ui-session-1",
      lane: "main",
      nodes: [
        {
          ...sampleInventory.nodes[0],
          connected: true,
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
      renderPairingPage(root, core);
    });

    await act(async () => {
      await flushPairingPage();
    });

    expandNodeRow(container, "node-1");
    expect(container.querySelector('[data-testid="pairing-attached-local-1"]')).toBeNull();
    expect(container.querySelector('[data-testid="pairing-attached-lane-1"]')).not.toBeNull();
    expect(
      container.querySelector('[data-testid="pairing-row-toggle-node-1"]')?.className ?? "",
    ).not.toContain("bg-primary/5");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("renders one sorted list for pending, connected, and offline nodes", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsList, nodesList } = createFakeHttpClient();
    const sampleInventory = sampleNodeInventoryResponse();
    pairingsList.mockResolvedValue({
      status: "ok",
      pairings: [
        {
          pairing_id: 1,
          status: "awaiting_human",
          requested_at: "2026-01-03T00:00:00.000Z",
          node: {
            node_id: "node-1",
            label: "pending node",
            last_seen_at: "2026-01-03T00:00:00.000Z",
            capabilities: [{ id: "tyrum.cli", version: "1.0.0" }],
          },
          capability_allowlist: [{ id: "tyrum.cli", version: "1.0.0" }],
          trust_level: "local",
          resolution: null,
          resolved_at: null,
        },
        {
          pairing_id: 2,
          status: "approved",
          requested_at: "2026-01-01T00:00:00.000Z",
          node: {
            node_id: "node-3",
            label: "offline trusted node",
            last_seen_at: "2026-01-01T00:00:00.000Z",
            capabilities: [],
          },
          capability_allowlist: [{ id: "tyrum.cli", version: "1.0.0" }],
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
    nodesList.mockResolvedValue({
      ...sampleInventory,
      nodes: [
        {
          ...sampleInventory.nodes[0],
          node_id: "node-1",
          label: "pending node",
          connected: true,
          paired_status: "awaiting_human",
          mode: "desktop",
          capabilities: [sampleCapabilitySummary("tyrum.cli")],
        },
        {
          ...sampleInventory.nodes[0],
          node_id: "node-2",
          label: "new node",
          connected: true,
          paired_status: null,
          mode: "browser",
          capabilities: [
            sampleCapabilitySummary("tyrum.http"),
            sampleCapabilitySummary("tyrum.cli"),
          ],
        },
        {
          ...sampleInventory.nodes[0],
          node_id: "node-3",
          label: "offline trusted node",
          connected: false,
          paired_status: "approved",
          capabilities: [sampleCapabilitySummary("tyrum.cli")],
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

    const container = document.createElement("div");
    document.body.appendChild(container);

    let root: Root | null = null;
    act(() => {
      root = createRoot(container);
      renderPairingPage(root, core);
    });

    await act(async () => {
      await flushPairingPage();
    });

    expect(container.querySelector('[data-testid="pairing-list"]')).not.toBeNull();
    expect(container.textContent).toContain("1 pending, 1 connected, 1 offline");

    const toggles = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[data-testid^="pairing-row-toggle-"]'),
    ).map((button) => button.getAttribute("data-testid"));
    expect(toggles).toEqual([
      "pairing-row-toggle-node-1",
      "pairing-row-toggle-node-2",
      "pairing-row-toggle-node-3",
    ]);

    expect(container.querySelector('[data-testid="pairing-row-details-node-1"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="pairing-row-identifier-node-1"]')?.textContent,
    ).toBe("node-1");
    expect(container.querySelector('[data-testid="pairing-row-tools-node-2"]')?.textContent).toBe(
      "2",
    );
    expect(container.querySelector('[data-testid="pairing-row-node-1"]')?.textContent).toContain(
      "Pending",
    );
    expect(container.querySelector('[data-testid="pairing-row-node-2"]')?.textContent).toContain(
      "Connected",
    );
    expect(container.querySelector('[data-testid="pairing-row-node-3"]')?.textContent).toContain(
      "Offline",
    );

    expandNodeRow(container, "node-2");
    expect(
      container.querySelector('[data-testid="pairing-row-details-node-2"]')?.textContent,
    ).toContain("Connected node");
    expect(
      container.querySelector('[data-testid="pairing-row-details-node-2"]')?.textContent,
    ).toContain("Unpaired");

    expandNodeRow(container, "node-3");
    expect(container.querySelector('[data-testid="pairing-row-details-node-2"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="pairing-row-details-node-3"]')?.textContent,
    ).toContain("Trusted node");

    act(() => {
      root?.unmount();
    });
    container.remove();
  });
}
