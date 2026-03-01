// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { WsJsonPanel } from "../../src/components/admin-workboard/ws-json-panel.js";
import { cleanupTestRoot, click, renderIntoDocument, setNativeValue } from "../test-utils.js";

describe("WsJsonPanel", () => {
  it("clears prior renderResult when payload JSON is not an object", async () => {
    const run = vi.fn(async () => ({ ok: true }));

    const testRoot = renderIntoDocument(
      React.createElement(WsJsonPanel, {
        title: "work.list",
        scope: { tenant_id: "tenant-1", agent_id: "agent-1", workspace_id: "ws-1" },
        onScopeErrors: vi.fn(),
        payloadTestId: "payload",
        runTestId: "run",
        defaultPayload: {},
        run,
        renderResult: () =>
          React.createElement("div", { "data-testid": "render-result" }, "Rendered result"),
      }),
    );

    const payload =
      testRoot.container.querySelector<HTMLTextAreaElement>('[data-testid="payload"]');
    const runButton = testRoot.container.querySelector<HTMLButtonElement>('[data-testid="run"]');
    expect(payload).not.toBeNull();
    expect(runButton).not.toBeNull();

    await act(async () => {
      click(runButton!);
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(testRoot.container.querySelector('[data-testid="render-result"]')).not.toBeNull();

    await act(async () => {
      setNativeValue(payload!, "[]");
      click(runButton!);
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(testRoot.container.textContent).toContain("Payload must be a JSON object");
    expect(testRoot.container.querySelector('[data-testid="render-result"]')).toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("clears prior renderResult when payload JSON is invalid", async () => {
    const run = vi.fn(async () => ({ ok: true }));

    const testRoot = renderIntoDocument(
      React.createElement(WsJsonPanel, {
        title: "work.list",
        scope: { tenant_id: "tenant-1", agent_id: "agent-1", workspace_id: "ws-1" },
        onScopeErrors: vi.fn(),
        payloadTestId: "payload",
        runTestId: "run",
        defaultPayload: {},
        run,
        renderResult: () =>
          React.createElement("div", { "data-testid": "render-result" }, "Rendered result"),
      }),
    );

    const payload =
      testRoot.container.querySelector<HTMLTextAreaElement>('[data-testid="payload"]');
    const runButton = testRoot.container.querySelector<HTMLButtonElement>('[data-testid="run"]');
    expect(payload).not.toBeNull();
    expect(runButton).not.toBeNull();

    await act(async () => {
      click(runButton!);
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(testRoot.container.querySelector('[data-testid="render-result"]')).not.toBeNull();

    await act(async () => {
      setNativeValue(payload!, "{");
      click(runButton!);
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalledTimes(1);
    expect(testRoot.container.textContent).toContain("Invalid JSON:");
    expect(testRoot.container.querySelector('[data-testid="render-result"]')).toBeNull();

    cleanupTestRoot(testRoot);
  });

  it("guards against concurrent requests before busy is rendered", async () => {
    const run = vi.fn(async () => ({ ok: true }));

    const testRoot = renderIntoDocument(
      React.createElement(WsJsonPanel, {
        title: "work.list",
        scope: { tenant_id: "tenant-1", agent_id: "agent-1", workspace_id: "ws-1" },
        onScopeErrors: vi.fn(),
        payloadTestId: "payload",
        runTestId: "run",
        defaultPayload: {},
        run,
      }),
    );

    const runButton = testRoot.container.querySelector<HTMLButtonElement>('[data-testid="run"]');
    expect(runButton).not.toBeNull();

    await act(async () => {
      click(runButton!);
      click(runButton!);
      await Promise.resolve();
    });

    expect(run).toHaveBeenCalledTimes(1);

    cleanupTestRoot(testRoot);
  });
});
