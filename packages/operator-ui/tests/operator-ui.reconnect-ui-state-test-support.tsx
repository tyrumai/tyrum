import { AgentConfig, IdentityPack } from "@tyrum/contracts";
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createBearerTokenAuth, createOperatorCore } from "../../operator-app/src/index.js";
import { createStore } from "../../operator-app/src/store.js";
import type { OperatorCore } from "../../operator-app/src/index.js";
import { OperatorUiApp } from "../src/index.js";
import { AgentsPage } from "../src/components/pages/agents-page.js";
import { RetainedUiStateProvider, useReconnectTabState } from "../src/reconnect-ui-state.js";
import { createModelConfigHttpFixtures } from "./operator-ui.admin-http-fixtures.js";
import {
  TEST_DEVICE_IDENTITY,
  openConfigureTab,
  waitForSelector,
} from "./operator-ui.test-support.js";
import { FakeWsClient, createFakeHttpClient } from "./operator-ui.test-fixtures.js";

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
  const { modelConfig } = createModelConfigHttpFixtures();
  const { store: connectionStore } = createStore({
    status: "connected",
    clientId: null,
    lastDisconnect: null,
    transportError: null,
    recovering: false,
  });
  const { store: statusStore } = createStore({
    status: { session_lanes: null },
    usage: null,
    presenceByInstanceId: {},
    loading: { status: false, usage: false, presence: false },
    error: { status: null, usage: null, presence: null },
    lastSyncedAt: null,
  });
  const { store: agentStatusStore, setState: setAgentStatusState } = createStore({
    agentKey: "default",
    status: null,
    loading: false,
    error: null,
    lastSyncedAt: null,
  });
  const { store: runsStore } = createStore({
    runsById: {},
    stepsById: {},
    attemptsById: {},
    stepIdsByRunId: {},
    attemptIdsByStepId: {},
    agentKeyByRunId: {},
  });

  const core = {
    connectionStore,
    statusStore,
    agentStatusStore: {
      ...agentStatusStore,
      setAgentKey: vi.fn((agentKey: string) => {
        setAgentStatusState((prev) => ({ ...prev, agentKey }));
      }),
      refresh: vi.fn().mockResolvedValue(undefined),
    },
    http: {
      agents: {
        list: vi.fn(async () => ({
          agents: [
            {
              agent_key: "default",
              agent_id: "11111111-1111-4111-8111-111111111111",
              can_delete: false,
              persona: { name: "Default Agent" },
            },
          ],
        })),
        get: vi.fn().mockResolvedValue({
          agent_id: "11111111-1111-4111-8111-111111111111",
          agent_key: "default",
          created_at: "2026-03-08T00:00:00.000Z",
          updated_at: "2026-03-08T00:00:00.000Z",
          has_config: true,
          has_identity: true,
          can_delete: false,
          persona: {
            name: "Default Agent",
            tone: "direct",
            palette: "graphite",
            character: "architect",
          },
          config: AgentConfig.parse({
            model: { model: "openai/gpt-4.1" },
            persona: {
              name: "Default Agent",
              tone: "direct",
              palette: "graphite",
              character: "architect",
            },
          }),
          identity: IdentityPack.parse({
            meta: {
              name: "Default Agent",
              style: { tone: "direct" },
            },
          }),
          config_revision: 1,
          identity_revision: 1,
          config_sha256: "a".repeat(64),
          identity_sha256: "b".repeat(64),
        }),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        capabilities: vi.fn(async () => ({
          skills: {
            default_mode: "allow",
            allow: [],
            deny: [],
            workspace_trusted: true,
            items: [],
          },
          mcp: { default_mode: "allow", allow: [], deny: [], items: [] },
          tools: { default_mode: "allow", allow: [], deny: [], items: [] },
        })),
      },
      modelConfig,
    },
    runsStore,
  } as unknown as OperatorCore & {
    http: OperatorCore["admin"];
  };
  core.admin = core.http;
  return core;
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

    it("restores the agents detail tab and scroll after a remount", async () => {
      const core = createAgentsCore();
      const container = document.createElement("div");
      document.body.appendChild(container);

      let root: Root | null = null;
      await act(async () => {
        root = createRoot(container);
        root.render(<AgentsHarness visible={true} core={core} />);
      });
      await flush();

      const runsTab = await waitForSelector<HTMLButtonElement>(
        container,
        '[data-testid="agents-tab-runs"]',
      );
      await act(async () => {
        runsTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
        await Promise.resolve();
      });

      const initialViewport = await waitForSelector<HTMLElement>(
        container,
        '[data-testid="agents-detail-pane"] [data-scroll-area-viewport]',
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

      await waitForSelector<HTMLElement>(
        container,
        '[data-testid="agents-tab-runs"][data-state="active"]',
      );
      const restoredViewport = await waitForSelector<HTMLElement>(
        container,
        '[data-testid="agents-detail-pane"] [data-scroll-area-viewport]',
      );
      expect(restoredViewport.scrollTop).toBe(180);

      act(() => {
        root?.unmount();
      });
      container.remove();
    });
  });
}
