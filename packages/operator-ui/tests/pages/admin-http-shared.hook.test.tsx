// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createElevatedModeStore, type OperatorCore } from "@tyrum/operator-core";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { useAdminHttpClient } from "../../src/components/pages/admin-http-shared.js";
import { cleanupTestRoot, renderIntoDocument, type TestRoot } from "../test-utils.js";

function createTestCore() {
  const baseStore = createElevatedModeStore({ tickIntervalMs: 0 });
  let subscribeCalls = 0;
  const elevatedModeStore = {
    ...baseStore,
    subscribe(listener: () => void) {
      subscribeCalls += 1;
      return baseStore.subscribe(listener);
    },
  };
  const readHttp = { providerConfig: { listRegistry: async () => ({ providers: [] }) } };
  const core = {
    elevatedModeStore,
    http: readHttp,
    httpBaseUrl: "http://example.test",
  } as unknown as OperatorCore;

  return {
    baseStore,
    core,
    readHttp: readHttp as OperatorCore["http"],
    getSubscribeCalls: () => subscribeCalls,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useAdminHttpClient", () => {
  it("returns the baseline read client without adding an elevated mode subscription", () => {
    const { baseStore, core, readHttp, getSubscribeCalls } = createTestCore();
    let testRoot: TestRoot | null = null;
    let resolvedClient: OperatorCore["http"] | null = null;

    function ReadProbe() {
      resolvedClient = useAdminHttpClient();
      return null;
    }

    try {
      testRoot = renderIntoDocument(
        <ElevatedModeProvider core={core} mode="web">
          <ReadProbe />
        </ElevatedModeProvider>,
      );

      expect(resolvedClient).toBe(readHttp);
      expect(getSubscribeCalls()).toBe(1);
    } finally {
      if (testRoot) cleanupTestRoot(testRoot);
      baseStore.dispose();
    }
  });

  it("keeps strict mode subscribed to elevated access state", () => {
    const { baseStore, core, getSubscribeCalls } = createTestCore();
    let testRoot: TestRoot | null = null;
    let hasStrictClient = false;

    function StrictProbe() {
      hasStrictClient = useAdminHttpClient({ access: "strict" }) !== null;
      return null;
    }

    try {
      testRoot = renderIntoDocument(
        <ElevatedModeProvider core={core} mode="web">
          <StrictProbe />
        </ElevatedModeProvider>,
      );

      expect(hasStrictClient).toBe(false);
      expect(getSubscribeCalls()).toBe(2);

      act(() => {
        baseStore.enter({
          elevatedToken: "strict-token",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      });

      expect(hasStrictClient).toBe(true);
    } finally {
      if (testRoot) cleanupTestRoot(testRoot);
      baseStore.dispose();
    }
  });
});
