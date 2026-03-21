// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import React, { act } from "react";
import { createBearerTokenAuth, createOperatorCore } from "../../../operator-app/src/index.js";
import { createOperatorUiTestCoreWithAdminAccess } from "../operator-ui.admin-access-test-support.js";
import { AdminAccessProvider } from "../../src/index.js";
import { PairingPage } from "../../src/components/pages/pairing-page.js";
import {
  FakeWsClient,
  createFakeHttpClient,
  sampleNodeInventoryResponse,
  samplePairingRequestApproved,
  samplePairingRequestPending,
  samplePairingRequestPendingWithNodeCapabilities,
} from "../operator-ui.test-fixtures.js";
import { cleanupTestRoot, click, renderIntoDocument, setNativeValue } from "../test-utils.js";

const NOOP_ADMIN_ACCESS_CONTROLLER = {
  enter: async () => {},
  exit: async () => {},
};

function renderPairingPage(core: Parameters<typeof PairingPage>[0]["core"]) {
  return renderIntoDocument(
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
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function expandNodeRow(container: HTMLElement, rowKey: string): void {
  const row = container.querySelector<HTMLElement>(`[data-testid="pairing-row-${rowKey}"]`);
  expect(row).not.toBeNull();
  act(() => {
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function listRenderedPairingRows(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid^="pairing-row-"]'))
    .map((el) => el.getAttribute("data-testid"))
    .filter(
      (id): id is string => id !== null && !id.includes("identifier") && !id.includes("tools"),
    );
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

describe("PairingPage", () => {
  it("renders one sorted list and keeps only one row expanded", async () => {
    const ws = new FakeWsClient();
    const { http, nodesList, pairingsList } = createFakeHttpClient();
    const sampleInventory = sampleNodeInventoryResponse();
    pairingsList.mockResolvedValue({
      status: "ok",
      pairings: [
        {
          ...samplePairingRequestPending(),
          node: {
            ...samplePairingRequestPending().node,
            node_id: "node-1",
            label: "pending node",
          },
          requested_at: "2026-01-03T00:00:00.000Z",
        },
        {
          ...samplePairingRequestApproved(),
          pairing_id: 2,
          node: {
            ...samplePairingRequestApproved().node,
            node_id: "node-3",
            label: "offline trusted node",
          },
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
          label: "browser node",
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
      deps: { ws, http },
    });

    const { container, root } = renderPairingPage(core);

    try {
      await flushPairingPage();

      // Rows are rendered as <tr> elements with data-testid="pairing-row-<key>"
      // Keys: pairing:1 (pending node-1), node:node-2 (connected), pairing:2 (offline node-3)
      const rows = listRenderedPairingRows(container);
      expect(rows).toEqual([
        "pairing-row-pairing:1",
        "pairing-row-node:node-2",
        "pairing-row-pairing:2",
      ]);
      expect(container.textContent).toContain("1 pending, 1 connected, 1 offline");
      expect(container.querySelector('[data-testid="pairing-row-tools-node-2"]')?.textContent).toBe(
        "2",
      );

      expandNodeRow(container, "node:node-2");
      expect(container.textContent).toContain("Connected node");
      expect(container.textContent).toContain("Unpaired");

      expandNodeRow(container, "pairing:2");
      expect(container.textContent).toContain("Trusted node");
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("does not duplicate a disconnected node when pending and approved pairings share the same node", async () => {
    const ws = new FakeWsClient();
    const { http, nodesList, pairingsList } = createFakeHttpClient();
    const sampleInventory = sampleNodeInventoryResponse();
    const pendingPairing = {
      ...samplePairingRequestPending(),
      pairing_id: 1,
      status: "awaiting_human" as const,
      requested_at: "2026-01-03T00:00:00.000Z",
      node: {
        ...samplePairingRequestPending().node,
        node_id: "node-1",
        label: "shared node",
        last_seen_at: "2026-01-03T00:00:00.000Z",
      },
    };
    const approvedPairing = {
      ...samplePairingRequestApproved(),
      pairing_id: 2,
      node: {
        ...samplePairingRequestApproved().node,
        node_id: "node-1",
        label: "shared node",
        last_seen_at: "2026-01-02T00:00:00.000Z",
      },
    };

    pairingsList.mockResolvedValue({
      status: "ok",
      pairings: [pendingPairing, approvedPairing],
    });
    nodesList.mockResolvedValue({
      ...sampleInventory,
      nodes: [],
    });

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const { container, root } = renderPairingPage(core);

    try {
      await flushPairingPage();

      expect(listRenderedPairingRows(container)).toEqual(["pairing-row-pairing:1"]);
      expect(container.textContent).toContain("1 pending, 0 connected, 0 offline");
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("filters rows by the visible node label", async () => {
    const ws = new FakeWsClient();
    const { http, nodesList, pairingsList } = createFakeHttpClient();
    const sampleInventory = sampleNodeInventoryResponse();
    pairingsList.mockResolvedValue({
      status: "ok",
      pairings: [],
    });
    nodesList.mockResolvedValue({
      ...sampleInventory,
      nodes: [
        {
          ...sampleInventory.nodes[0],
          node_id: "node-1",
          label: "My Desktop",
          connected: true,
          paired_status: "approved",
          mode: "desktop",
          capabilities: [sampleCapabilitySummary("tyrum.cli")],
        },
        {
          ...sampleInventory.nodes[0],
          node_id: "node-2",
          label: "Background Worker",
          connected: true,
          paired_status: "approved",
          mode: "worker",
          capabilities: [sampleCapabilitySummary("tyrum.http")],
        },
      ],
    });

    const core = createOperatorCore({
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      auth: createBearerTokenAuth("test"),
      deps: { ws, http },
    });

    const { container, root } = renderPairingPage(core);

    try {
      await flushPairingPage();

      const search = container.querySelector<HTMLInputElement>('[data-testid="pairing-search"]');
      expect(search).not.toBeNull();
      setNativeValue(search as HTMLInputElement, "desktop");
      await flushPairingPage();

      expect(listRenderedPairingRows(container)).toEqual(["pairing-row-node:node-1"]);
      expect(
        container.querySelector('[data-testid="pairing-row-identifier-node-1"]')?.textContent,
      ).toContain("My Desktop");
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("approves a pending row from the expanded details", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsApprove, pairingsList } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({
      status: "ok",
      pairings: [samplePairingRequestPendingWithNodeCapabilities()],
    });
    pairingsApprove.mockResolvedValueOnce({
      status: "ok",
      pairing: samplePairingRequestApproved(),
    });

    const core = createOperatorUiTestCoreWithAdminAccess({ ws, http });
    const { container, root } = renderPairingPage(core);

    try {
      await flushPairingPage();

      expandNodeRow(container, "pairing:1");

      const trustRemote = container.querySelector<HTMLButtonElement>(
        '[data-testid="pairing-trust-level-1-remote"]',
      );
      expect(trustRemote).not.toBeNull();
      act(() => {
        click(trustRemote as HTMLButtonElement);
      });

      const capability0 = container.querySelector<HTMLButtonElement>(
        '[data-testid="pairing-capability-1-0"]',
      );
      expect(capability0).not.toBeNull();
      act(() => {
        click(capability0 as HTMLButtonElement);
      });

      const reason = container.querySelector<HTMLTextAreaElement>(
        '[data-testid="pairing-reason-1"]',
      );
      expect(reason).not.toBeNull();
      act(() => {
        setNativeValue(reason as HTMLTextAreaElement, "ok");
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
        trust_level: "remote",
        capability_allowlist: [{ id: "tyrum.http", version: "1.0.0" }],
        reason: "ok",
      });
      expect(container.querySelector('[data-testid="pairing-approve-1"]')).toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("denies a pending row from the expanded details", async () => {
    const ws = new FakeWsClient();
    const { http, pairingsDeny, pairingsList } = createFakeHttpClient();
    pairingsList.mockResolvedValueOnce({ status: "ok", pairings: [samplePairingRequestPending()] });
    pairingsDeny.mockResolvedValueOnce({
      status: "ok",
      pairing: {
        ...samplePairingRequestPending(),
        status: "denied",
      },
    });

    const core = createOperatorUiTestCoreWithAdminAccess({ ws, http });
    const { container, root } = renderPairingPage(core);

    try {
      await flushPairingPage();
      expandNodeRow(container, "pairing:1");

      const denyButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="pairing-deny-1"]',
      );
      expect(denyButton).not.toBeNull();

      await act(async () => {
        denyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(pairingsDeny).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="pairing-deny-1"]')).toBeNull();
    } finally {
      cleanupTestRoot({ container, root });
    }
  });

  it("revokes an approved row from the expanded details", async () => {
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
      },
    });

    const core = createOperatorUiTestCoreWithAdminAccess({ ws, http });
    const { container, root } = renderPairingPage(core);

    try {
      await flushPairingPage();
      expandNodeRow(container, "pairing:1");

      const revokeButton = container.querySelector<HTMLButtonElement>(
        '[data-testid="pairing-revoke-1"]',
      );
      expect(revokeButton).not.toBeNull();

      await act(async () => {
        revokeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      expect(pairingsRevoke).toHaveBeenCalledTimes(1);
    } finally {
      cleanupTestRoot({ container, root });
    }
  });
});
