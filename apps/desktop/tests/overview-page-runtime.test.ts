// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupTestRoot,
  createTestRoot,
  type TestRoot,
} from "../../../packages/operator-ui/tests/test-utils.js";

describe("Overview page", () => {
  let testRoot: TestRoot;
  let onStatusChange: ((payload: unknown) => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    testRoot = createTestRoot();
    onStatusChange = null;

    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {
      getConfig: vi.fn(async () => ({
        mode: "embedded",
        embedded: { port: 8788 },
        capabilities: { cli: true },
      })),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
      },
      onStatusChange: vi.fn((cb: (payload: unknown) => void) => {
        onStatusChange = cb;
        return () => {};
      }),
    };
  });

  afterEach(() => {
    cleanupTestRoot(testRoot);
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
  });

  it("renders gateway status and capability badges and reacts to status changes", async () => {
    const { Overview } = await import("../src/renderer/pages/Overview.js");

    await act(async () => {
      testRoot.root.render(createElement(Overview));
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.body.textContent).toContain("Overview");
    expect(document.body.textContent).toContain("Connected Capabilities");
    expect(document.body.textContent).toContain("cli");

    if (!onStatusChange) {
      throw new Error("expected status subscription to be registered");
    }

    const setGatewayStatus = async (gatewayStatus: string) => {
      await act(async () => {
        onStatusChange?.({ gatewayStatus });
      });
    };

    await setGatewayStatus("running");
    expect(document.body.textContent).toContain("Running");

    await setGatewayStatus("starting");
    expect(document.body.textContent).toContain("Starting");

    await setGatewayStatus("error");
    expect(document.body.textContent).toContain("Error");

    await setGatewayStatus("stopped");
    expect(document.body.textContent).toContain("Stopped");

    await setGatewayStatus("");
  });
});
