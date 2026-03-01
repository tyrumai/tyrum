// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createStore } from "../../../operator-core/src/store.js";
import { AdminModeProvider } from "../../src/admin-mode.js";
import { AdminPage } from "../../src/components/pages/admin-page.js";
import {
  cleanupTestRoot,
  clickRadix as click,
  renderIntoDocument,
  setNativeValue,
} from "../test-utils.js";

function createAdminModeStoreActive() {
  const { store } = createStore({
    status: "active",
    elevatedToken: "token-1",
    enteredAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T00:10:00.000Z",
    remainingMs: 60_000,
  });

  return {
    ...store,
    enter: vi.fn(),
    exit: vi.fn(),
    dispose: vi.fn(),
  };
}

describe("AdminPage (WS Subagents)", () => {
  it("renders Subagents panels and wires WebSocket requests", async () => {
    const scope = { tenant_id: "tenant-1", agent_id: "agent-1", workspace_id: "default" } as const;
    const subagentId = "123e4567-e89b-12d3-a456-426614174222";

    const ws = {
      connected: true,
      on: vi.fn(),
      off: vi.fn(),
      subagentSpawn: vi.fn(async () => ({
        subagent: {
          subagent_id: subagentId,
          ...scope,
          execution_profile: "default",
          session_key: `agent:${scope.agent_id}:subagent:${subagentId}`,
          lane: "subagent",
          status: "running",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      })),
      subagentList: vi.fn(async () => ({ subagents: [], next_cursor: undefined })),
      subagentGet: vi.fn(async () => ({
        subagent: {
          subagent_id: subagentId,
          ...scope,
          execution_profile: "default",
          session_key: `agent:${scope.agent_id}:subagent:${subagentId}`,
          lane: "subagent",
          status: "running",
          created_at: "2026-01-01T00:00:00.000Z",
        },
      })),
      subagentSend: vi.fn(async () => ({ accepted: true })),
      subagentClose: vi.fn(async () => ({
        subagent: {
          subagent_id: subagentId,
          ...scope,
          execution_profile: "default",
          session_key: `agent:${scope.agent_id}:subagent:${subagentId}`,
          lane: "subagent",
          status: "closed",
          created_at: "2026-01-01T00:00:00.000Z",
          closed_at: "2026-01-01T00:01:00.000Z",
        },
      })),
    };

    const core = {
      wsUrl: "ws://example.test/ws",
      httpBaseUrl: "http://example.test",
      ws,
      adminModeStore: createAdminModeStoreActive(),
    } as unknown as OperatorCore;

    const testRoot = renderIntoDocument(
      React.createElement(
        AdminModeProvider,
        { core, mode: "desktop" },
        React.createElement(AdminPage, { core }),
      ),
    );

    const wsTab = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="admin-tab-ws"]',
    );
    expect(wsTab).not.toBeNull();
    await act(async () => {
      click(wsTab!);
    });

    expect(testRoot.container.querySelector('[data-testid="admin-ws-subagents"]')).not.toBeNull();

    const writePayload = async (testId: string, payload: unknown): Promise<void> => {
      const textarea = testRoot.container.querySelector<HTMLTextAreaElement>(
        `[data-testid="${testId}"]`,
      );
      expect(textarea).not.toBeNull();
      await act(async () => {
        setNativeValue(textarea!, JSON.stringify(payload, null, 2));
      });
    };

    const submit = async (testId: string): Promise<void> => {
      const button = testRoot.container.querySelector<HTMLButtonElement>(
        `[data-testid="${testId}"]`,
      );
      expect(button).not.toBeNull();
      await act(async () => {
        click(button!);
      });
      await act(async () => {});
    };

    await writePayload("admin-ws-subagent-spawn-payload", {
      ...scope,
      execution_profile: "default",
    });
    await submit("admin-ws-subagent-spawn-submit");
    expect(ws.subagentSpawn).toHaveBeenCalledWith({ ...scope, execution_profile: "default" });

    await writePayload("admin-ws-subagent-list-payload", {
      ...scope,
      statuses: ["running"],
      limit: 20,
    });
    await submit("admin-ws-subagent-list-submit");
    expect(ws.subagentList).toHaveBeenCalledWith({ ...scope, statuses: ["running"], limit: 20 });

    await writePayload("admin-ws-subagent-get-payload", { ...scope, subagent_id: subagentId });
    await submit("admin-ws-subagent-get-submit");
    expect(ws.subagentGet).toHaveBeenCalledWith({ ...scope, subagent_id: subagentId });

    await writePayload("admin-ws-subagent-send-payload", {
      ...scope,
      subagent_id: subagentId,
      content: "Hello",
    });
    await submit("admin-ws-subagent-send-submit");
    expect(ws.subagentSend).toHaveBeenCalledWith({
      ...scope,
      subagent_id: subagentId,
      content: "Hello",
    });

    await writePayload("admin-ws-subagent-close-payload", {
      ...scope,
      subagent_id: subagentId,
      reason: "done",
    });
    await submit("admin-ws-subagent-close-submit");
    expect(ws.subagentClose).toHaveBeenCalledWith({
      ...scope,
      subagent_id: subagentId,
      reason: "done",
    });

    cleanupTestRoot(testRoot);
  });
});
