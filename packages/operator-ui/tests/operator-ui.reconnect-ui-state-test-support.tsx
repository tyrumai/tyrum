import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import type { OperatorCore } from "../../operator-app/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import { AgentsPage } from "../src/components/pages/agents-page.js";
import { RetainedUiStateProvider, useReconnectTabState } from "../src/reconnect-ui-state.js";
import {
  TEST_DEVICE_IDENTITY,
  openConfigureTab,
  waitForSelector,
} from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";
import { createCore as createAgentsPageCore } from "./pages/agents-page.test-support.tsx";

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await vi.dynamicImportSettled();
  });
}

function setViewportScrollTop(viewport: HTMLElement, value: number): void {
  viewport.scrollTop = value;
  viewport.dispatchEvent(new Event("scroll"));
}

function createConnectedOperatorCore(initiallyConnected: boolean): {
  core: OperatorCore;
  ws: FakeWsClient;
} {
  const ws = new FakeWsClient(initiallyConnected);
  const { http } = createFakeHttpClient();
  const core = createOperatorCore({
    wsUrl: "ws://example.test/ws",
    httpBaseUrl: "http://example.test",
    auth: createBearerTokenAuth("test-token"),
    deviceIdentity: TEST_DEVICE_IDENTITY,
    deps: { ws, http },
  });
  return { core, ws };
}

function createAgentsCore(): OperatorCore {
  return createAgentsPageCore({
    list: vi.fn(async () => ({
      agents: [
        {
          agent_key: "default",
          agent_id: "11111111-1111-4111-8111-111111111111",
          can_delete: false,
          is_primary: true,
          persona: { name: "Default Agent" },
        },
      ],
    })),
  }).core;
}

function TabHarness() {
  const [tab, setTab] = useReconnectTabState("test.tab", "alpha");
  return (
    <button
      type="button"
      data-testid="retained-tab"
      data-value={tab}
      onClick={() => {
        setTab("beta");
      }}
    >
      {tab}
    </button>
  );
}

function AgentsHarness({ visible, core }: { visible: boolean; core: OperatorCore }) {
  return (
    <RetainedUiStateProvider scopeKey="desktop:http://example.test:operator-ui-device-1">
      {visible ? <AgentsPage core={core} /> : null}
    </RetainedUiStateProvider>
  );
}

export function registerReconnectUiStateTests(): void {
  describe("reconnect UI state", () => {
    it("resets retained tab state when the connection identity changes", async () => {
      const container = document.createElement("div");
      document.body.appendChild(container);

      let root: Root | null = null;
      await act(async () => {
        root = createRoot(container);
        root.render(
          <RetainedUiStateProvider scopeKey="web:http://example.test:device-a">
            <TabHarness />
          </RetainedUiStateProvider>,
        );
      });

      const button = await waitForSelector<HTMLButtonElement>(
        container,
        '[data-testid="retained-tab"]',
      );
      expect(button.dataset.value).toBe("alpha");

      act(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(button.dataset.value).toBe("beta");

      await act(async () => {
        root?.render(
          <RetainedUiStateProvider scopeKey="web:http://example.test:device-b">
            <TabHarness />
          </RetainedUiStateProvider>,
        );
      });

      expect(button.dataset.value).toBe("alpha");

      act(() => {
        root?.unmount();
      });
      container.remove();
    });

    it("restores the configure tab and page scroll after a core swap reconnect", async () => {
      const first = createConnectedOperatorCore(true);
      const second = createConnectedOperatorCore(false);
      const container = document.createElement("div");
      document.body.appendChild(container);

      let root: Root | null = null;
      await act(async () => {
        root = createRoot(container);
        root.render(<OperatorUiApp core={first.core} mode="desktop" />);
      });

      await openConfigureTab(container, "admin-http-tab-providers");
      const initialViewport = await waitForSelector<HTMLElement>(
        container,
        '[data-testid="configure-page"] [data-scroll-area-viewport]',
      );
      setViewportScrollTop(initialViewport, 240);

      await act(async () => {
        root?.render(<OperatorUiApp core={second.core} mode="desktop" />);
        await Promise.resolve();
      });
      expect(container.querySelector('[data-testid="configure-page"]')).toBeNull();

      await act(async () => {
        second.ws.emit("connected", { clientId: null });
        await Promise.resolve();
      });

      const restoredViewport = await waitForSelector<HTMLElement>(
        container,
        '[data-testid="configure-page"] [data-scroll-area-viewport]',
      );
      const activeTab = container.querySelector<HTMLElement>(
        '[data-testid="admin-http-tab-providers"][data-state="active"]',
      );
      expect(activeTab).not.toBeNull();
      expect(restoredViewport.scrollTop).toBe(240);

      act(() => {
        root?.unmount();
      });
      container.remove();
    });

    it("restores the agents tree scroll after a remount", async () => {
      const core = createAgentsCore();
      const container = document.createElement("div");
      document.body.appendChild(container);

      let root: Root | null = null;
      await act(async () => {
        root = createRoot(container);
        root.render(<AgentsHarness visible={true} core={core} />);
      });
      await flush();

      const initialViewport = await waitForSelector<HTMLElement>(
        container,
        '[data-testid="agents-list-panel"] [data-scroll-area-viewport]',
      );
      setViewportScrollTop(initialViewport, 180);

      await act(async () => {
        root?.render(<AgentsHarness visible={false} core={core} />);
        await Promise.resolve();
      });
      expect(container.querySelector('[data-testid="agents-page"]')).toBeNull();

      await act(async () => {
        root?.render(<AgentsHarness visible={true} core={core} />);
        await Promise.resolve();
      });
      await flush();

      const restoredViewport = await waitForSelector<HTMLElement>(
        container,
        '[data-testid="agents-list-panel"] [data-scroll-area-viewport]',
      );
      expect(restoredViewport.scrollTop).toBe(180);

      act(() => {
        root?.unmount();
      });
      container.remove();
    });
  });
}
