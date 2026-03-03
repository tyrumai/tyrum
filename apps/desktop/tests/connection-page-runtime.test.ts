// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupTestRoot,
  createTestRoot,
  type TestRoot,
} from "../../../packages/operator-ui/tests/test-utils.js";
import { getButtonByText, getControlByLabelText, press, setInputValue } from "./test-utils/dom.js";

describe("Connection page", () => {
  let testRoot: TestRoot;
  let refreshConfigState: ReturnType<typeof vi.fn>;
  let retry: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    testRoot = createTestRoot();
    refreshConfigState = vi.fn(async () => {});
    retry = vi.fn();

    (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop = {
      getConfig: vi.fn(async () => ({ mode: "embedded", embedded: { port: 8788 } })),
      setConfig: vi.fn(async () => {}),
      gateway: {
        getStatus: vi.fn(async () => ({ status: "stopped", port: 8788 })),
        start: vi.fn(async () => ({ status: "running", port: 8788 })),
        stop: vi.fn(async () => ({ status: "stopped", port: 8788 })),
      },
      node: {
        connect: vi.fn(async () => ({ status: "connected" })),
        disconnect: vi.fn(async () => ({ status: "disconnected" })),
      },
      onStatusChange: vi.fn(() => () => {}),
    };
  });

  afterEach(() => {
    cleanupTestRoot(testRoot);
    delete (window as unknown as { tyrumDesktop?: unknown }).tyrumDesktop;
  });

  it("renders both tabs and updates the config inputs", async () => {
    const { ConnectionPage } = await import("../src/renderer/pages/ConnectionPage.js");

    await act(async () => {
      testRoot.root.render(
        createElement(ConnectionPage, {
          core: null,
          busy: false,
          errorMessage: null,
          retry,
          configExists: false,
          refreshConfigState,
          setupGateActive: true,
        }),
      );
    });

    await act(async () => {
      press(getButtonByText("Remote"));
    });

    const remoteUrl = getControlByLabelText("Gateway WebSocket URL");
    expect(remoteUrl).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      setInputValue(remoteUrl as HTMLInputElement, "ws://example.com/ws");
    });
    expect((remoteUrl as HTMLInputElement).value).toBe("ws://example.com/ws");

    const token = getControlByLabelText("Token");
    expect(token).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      setInputValue(token as HTMLInputElement, "secret");
    });
    expect((token as HTMLInputElement).value).toBe("secret");

    const fingerprint = getControlByLabelText("TLS certificate fingerprint (SHA-256, optional)");
    expect(fingerprint).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      setInputValue(fingerprint as HTMLInputElement, "AA:BB:CC");
    });
    expect((fingerprint as HTMLInputElement).value).toBe("AA:BB:CC");

    await act(async () => {
      press(getButtonByText("Connect"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const api = window.tyrumDesktop as unknown as { setConfig: ReturnType<typeof vi.fn> };
    expect(api.setConfig).toHaveBeenCalledWith({
      mode: "remote",
      remote: {
        wsUrl: "ws://example.com/ws",
        tokenRef: "secret",
        tlsCertFingerprint256: "AA:BB:CC",
      },
    });
    expect(refreshConfigState).toHaveBeenCalled();
    expect(retry).toHaveBeenCalled();

    await act(async () => {
      press(getButtonByText("Embedded"));
    });

    const port = getControlByLabelText("Port");
    expect(port).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      setInputValue(port as HTMLInputElement, "9999");
    });
    expect((port as HTMLInputElement).value).toBe("9999");

    await act(async () => {
      press(getButtonByText("Start Gateway"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.setConfig).toHaveBeenCalledWith({
      mode: "embedded",
      embedded: { port: 9999 },
    });
    expect(refreshConfigState).toHaveBeenCalled();
    expect(retry).toHaveBeenCalled();
  });
});
