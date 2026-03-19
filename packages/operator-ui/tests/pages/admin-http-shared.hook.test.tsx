// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElevatedModeStore, type OperatorCore } from "@tyrum/operator-app";
import { TyrumHttpClientError } from "@tyrum/operator-app/browser";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import {
  isAdminAccessHttpError,
  useAdminHttpClient,
} from "../../src/components/pages/admin-http-shared.js";
import { cleanupTestRoot, renderIntoDocument, type TestRoot } from "../test-utils.js";

function createTestCore(options?: { tickIntervalMs?: number }) {
  const baseStore = createElevatedModeStore({ tickIntervalMs: options?.tickIntervalMs ?? 0 });
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
    admin: readHttp,
    elevatedModeStore,
    http: readHttp,
    httpBaseUrl: "http://example.test",
  } as unknown as OperatorCore;

  return {
    baseStore,
    core,
    readHttp: readHttp as OperatorCore["admin"],
    getSubscribeCalls: () => subscribeCalls,
  };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("useAdminHttpClient", () => {
  it("returns the baseline read client until elevated access becomes active", () => {
    const { baseStore, core, readHttp, getSubscribeCalls } = createTestCore();
    let testRoot: TestRoot | null = null;
    let resolvedClient: OperatorCore["admin"] | null = null;

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
      expect(getSubscribeCalls()).toBe(2);

      act(() => {
        baseStore.enter({
          elevatedToken: "read-token",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        });
      });

      expect(resolvedClient).not.toBe(readHttp);
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

  it("keeps the elevated client stable across countdown ticks, recreates it for a new token, and falls back on exit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));

    const { baseStore, core, readHttp } = createTestCore({ tickIntervalMs: 1_000 });
    let testRoot: TestRoot | null = null;
    let resolvedClient: OperatorCore["admin"] | null = null;

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

      act(() => {
        baseStore.enter({
          elevatedToken: "token-1",
          expiresAt: "2026-03-01T00:01:00.000Z",
        });
      });

      const firstElevatedClient = resolvedClient;
      expect(firstElevatedClient).not.toBeNull();
      expect(firstElevatedClient).not.toBe(readHttp);

      act(() => {
        vi.advanceTimersByTime(1_000);
      });

      expect(resolvedClient).toBe(firstElevatedClient);

      act(() => {
        baseStore.enter({
          elevatedToken: "token-2",
          expiresAt: "2026-03-01T00:02:00.000Z",
        });
      });

      expect(resolvedClient).not.toBe(firstElevatedClient);
      expect(resolvedClient).not.toBe(readHttp);

      act(() => {
        baseStore.exit();
      });

      expect(resolvedClient).toBe(readHttp);
    } finally {
      if (testRoot) cleanupTestRoot(testRoot);
      baseStore.dispose();
    }
  });
});

describe("isAdminAccessHttpError", () => {
  it("matches the known admin-scope transport errors", () => {
    const error = new TyrumHttpClientError("http_error", "insufficient scope", {
      status: 403,
      error: "forbidden",
    });

    expect(isAdminAccessHttpError(error)).toBe(true);
  });

  it("rejects plain Errors with duck-typed forbidden fields", () => {
    const error = Object.assign(new Error("insufficient scope"), {
      status: 403,
      error: "forbidden",
    });

    expect(isAdminAccessHttpError(error)).toBe(false);
  });
});
