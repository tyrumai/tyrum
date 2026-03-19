// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupTestRoot } from "../../../packages/operator-ui/tests/test-utils.js";
import {
  cleanupBrowserNodeProviderHarness,
  createDeferredBrowserNodeIdentity,
  flushEffects,
  getBrowserNodeRuntimeState,
  getToNodeCapabilityStatesMock,
  renderProvider,
  resetBrowserNodeProviderHarness,
  stubBrowserApis,
  stubLocalStorage,
} from "./browser-node-provider.test-support.js";

beforeEach(() => {
  resetBrowserNodeProviderHarness();
});

afterEach(() => {
  cleanupBrowserNodeProviderHarness();
});

describe("BrowserNodeProvider lifecycle", () => {
  it("surfaces identity failures and ignores late identity completion after cleanup", async () => {
    stubLocalStorage({ "tyrum.operator-ui.browserNode.enabled": "1" });
    stubBrowserApis();
    getBrowserNodeRuntimeState().identityMode = "reject";
    getBrowserNodeRuntimeState().identityError = new Error("identity locked");

    const failed = await renderProvider();

    try {
      await flushEffects();
      await flushEffects();
      const api = failed.getApi();
      expect(api.status).toBe("error");
      expect(api.error).toBe("identity locked");
    } finally {
      cleanupTestRoot(failed.testRoot);
    }

    getBrowserNodeRuntimeState().reset();
    getBrowserNodeRuntimeState().identityMode = "deferred";
    getBrowserNodeRuntimeState().deferredIdentity = createDeferredBrowserNodeIdentity();
    stubLocalStorage({ "tyrum.operator-ui.browserNode.enabled": "1" });
    stubBrowserApis();

    const deferred = await renderProvider("ws://example.test/ws-late");
    cleanupTestRoot(deferred.testRoot);
    getBrowserNodeRuntimeState().deferredIdentity?.resolve({
      deviceId: "late-device",
      publicKey: "late-public",
      privateKey: "late-private",
    });
    await flushEffects();
    expect(getBrowserNodeRuntimeState().clients).toHaveLength(0);
  });

  it("reports unavailable actions, transport updates, and republished capability state", async () => {
    stubLocalStorage({ "tyrum.operator-ui.browserNode.enabled": "1" });
    stubBrowserApis({ mediaDevices: false, secureContext: false });

    const { getApi, testRoot } = await renderProvider();

    try {
      await flushEffects();
      await flushEffects();
      const api = getApi();

      await expect(
        api.executeLocal({
          op: "get",
          enable_high_accuracy: false,
          timeout_ms: 30_000,
          maximum_age_ms: 0,
        }),
      ).resolves.toEqual({
        success: false,
        error: "Geolocation requires a secure context and browser support.",
      });

      const lifecycleInput = getBrowserNodeRuntimeState().lifecycleInputs.at(-1);
      await act(async () => {
        lifecycleInput?.onTransportError?.({ message: "   " });
        await Promise.resolve();
      });
      await flushEffects();
      expect(getApi().error).toBeNull();

      await act(async () => {
        lifecycleInput?.onTransportError?.({ message: "network down" });
        await Promise.resolve();
      });
      await flushEffects();
      expect(getApi().error).toBe("network down");

      stubBrowserApis();
      const toNodeCapabilityStatesCallsBeforeToggle =
        getToNodeCapabilityStatesMock().mock.calls.length;
      const publishCallsBeforeToggle = getBrowserNodeRuntimeState().publishCalls.length;
      act(() => {
        api.setCapabilityEnabled("get", false);
      });
      await flushEffects();
      expect(getToNodeCapabilityStatesMock().mock.calls.length).toBe(
        toNodeCapabilityStatesCallsBeforeToggle + 1,
      );
      expect(getBrowserNodeRuntimeState().publishCalls.length).toBe(publishCallsBeforeToggle + 1);
      expect(getBrowserNodeRuntimeState().clients.at(-1)?.capabilityReady).toHaveBeenCalled();

      act(() => {
        api.setEnabled(false);
      });
      await flushEffects();
      expect(getApi().status).toBe("disabled");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });

  it("ignores late connection callbacks after cleanup", async () => {
    stubLocalStorage({ "tyrum.operator-ui.browserNode.enabled": "1" });
    stubBrowserApis();
    getBrowserNodeRuntimeState().connectMode = "microtask";

    const { testRoot } = await renderProvider("ws://example.test/ws-delayed");
    cleanupTestRoot(testRoot);
    await flushEffects();

    expect(getBrowserNodeRuntimeState().clients.at(-1)?.capabilityReady).not.toHaveBeenCalled();
  });
});
