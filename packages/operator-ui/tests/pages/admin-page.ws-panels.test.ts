// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import type { OperatorCore } from "../../../operator-core/src/index.js";
import { createAdminModeStore } from "../../../operator-core/src/index.js";
import { AdminModeProvider } from "../../src/admin-mode.js";
import { AdminPage } from "../../src/components/pages/admin-page.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function setReactTextValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  descriptor?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AdminPage WebSocket panels", () => {
  it("renders WS panels and wires requests", async () => {
    const ws = {
      commandExecute: vi.fn(async (command: string) => ({ output: `ok:${command}` })),
      ping: vi.fn(async () => {}),
      presenceBeacon: vi.fn(async (payload: unknown) => ({
        entry: {
          instance_id: "client-1",
          role: "client",
          last_seen_at: "2026-01-01T00:00:00.000Z",
          metadata: payload,
        },
      })),
      capabilityReady: vi.fn(async (_payload: unknown) => {}),
      attemptEvidence: vi.fn(async (_payload: unknown) => {}),
    };

    const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const adminModeStore = createAdminModeStore({ tickIntervalMs: 0, now: () => nowMs });
    adminModeStore.enter({
      elevatedToken: "token",
      expiresAt: "2026-01-01T00:10:00.000Z",
    });

    const core = {
      ws,
      adminModeStore,
      httpBaseUrl: "http://example.test",
    } as unknown as OperatorCore;

    const { container, root } = renderIntoDocument(
      React.createElement(AdminModeProvider, {
        core,
        mode: "web",
        children: React.createElement(AdminPage, { core }),
      }),
    );

    const wsTab = container.querySelector<HTMLButtonElement>(`[data-testid="admin-tab-ws"]`);
    expect(wsTab).not.toBeNull();
    act(() => {
      wsTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    });

    const commandInput = container.querySelector<HTMLInputElement>(
      `[data-testid="admin-ws-command-input"]`,
    );
    expect(commandInput).not.toBeNull();
    act(() => {
      setReactTextValue(commandInput!, "  /help  ");
    });

    const commandButton = container.querySelector<HTMLButtonElement>(
      `[data-testid="admin-ws-command-run"]`,
    );
    expect(commandButton).not.toBeNull();
    await act(async () => {
      commandButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(ws.commandExecute).toHaveBeenCalledWith("/help");

    const pingButton = container.querySelector<HTMLButtonElement>(
      `[data-testid="admin-ws-ping-run"]`,
    );
    expect(pingButton).not.toBeNull();
    await act(async () => {
      pingButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(ws.ping).toHaveBeenCalledTimes(1);

    const presencePayload = container.querySelector<HTMLTextAreaElement>(
      `[data-testid="admin-ws-presence-beacon-payload"]`,
    );
    expect(presencePayload).not.toBeNull();
    act(() => {
      setReactTextValue(presencePayload!, JSON.stringify({ mode: "ui" }));
    });

    const presenceButton = container.querySelector<HTMLButtonElement>(
      `[data-testid="admin-ws-presence-beacon-send"]`,
    );
    expect(presenceButton).not.toBeNull();
    await act(async () => {
      presenceButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(ws.presenceBeacon).toHaveBeenCalledWith({ mode: "ui" });

    const capabilityPayload = container.querySelector<HTMLTextAreaElement>(
      `[data-testid="admin-ws-capability-ready-payload"]`,
    );
    expect(capabilityPayload).not.toBeNull();
    act(() => {
      setReactTextValue(capabilityPayload!, JSON.stringify({ capabilities: [] }));
    });

    const capabilityButton = container.querySelector<HTMLButtonElement>(
      `[data-testid="admin-ws-capability-ready-send"]`,
    );
    expect(capabilityButton).not.toBeNull();
    await act(async () => {
      capabilityButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(ws.capabilityReady).toHaveBeenCalledWith({ capabilities: [] });

    const attemptPayload = container.querySelector<HTMLTextAreaElement>(
      `[data-testid="admin-ws-attempt-evidence-payload"]`,
    );
    expect(attemptPayload).not.toBeNull();
    act(() => {
      setReactTextValue(
        attemptPayload!,
        JSON.stringify({
          run_id: "run-1",
          step_id: "step-1",
          attempt_id: "attempt-1",
          evidence: { ok: true },
        }),
      );
    });

    const attemptButton = container.querySelector<HTMLButtonElement>(
      `[data-testid="admin-ws-attempt-evidence-send"]`,
    );
    expect(attemptButton).not.toBeNull();
    await act(async () => {
      attemptButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(ws.attemptEvidence).toHaveBeenCalledWith({
      run_id: "run-1",
      step_id: "step-1",
      attempt_id: "attempt-1",
      evidence: { ok: true },
    });

    cleanupTestRoot({ container, root });
  });
});

