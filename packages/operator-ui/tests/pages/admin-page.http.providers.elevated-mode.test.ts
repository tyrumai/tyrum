// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setNativeValue } from "../test-utils.js";
import {
  cleanupAdminHttpPage,
  flush,
  getByTestId,
  getLabeledInput,
  renderAdminHttpConfigurePage,
  switchHttpTab,
} from "./admin-page.http.test-support.js";
import { TEST_TIMESTAMP, createAdminHttpTestCore } from "./admin-page.http-fixture-support.js";
import { createElevatedModeStore } from "../../../operator-core/src/index.js";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP) providers elevated mode", () => {
  it("does not refetch providers on elevated countdown ticks", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(TEST_TIMESTAMP));

    const { core } = createAdminHttpTestCore();
    core.elevatedModeStore.dispose();
    core.elevatedModeStore = createElevatedModeStore();
    core.elevatedModeStore.enter({
      elevatedToken: "test-elevated-token",
      expiresAt: "2026-03-01T00:01:00.000Z",
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
      const method = init?.method ?? "GET";

      if (method === "GET" && url === "http://example.test/config/providers/registry") {
        return new Response(
          JSON.stringify({
            status: "ok",
            providers: [
              {
                provider_key: "openai",
                name: "OpenAI",
                doc: null,
                supported: true,
                methods: [
                  {
                    method_key: "api_key",
                    label: "API key",
                    type: "api_key",
                    fields: [
                      {
                        key: "api_key",
                        label: "API key",
                        description: null,
                        kind: "secret",
                        input: "password",
                        required: true,
                      },
                    ],
                  },
                ],
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (method === "GET" && url === "http://example.test/config/providers") {
        return new Response(JSON.stringify({ status: "ok", providers: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const page = renderAdminHttpConfigurePage(core);
    try {
      await switchHttpTab(page.container, "admin-http-tab-providers");
      await flush();
      await flush();

      const initialProviderReads = fetchMock.mock.calls.filter(([input, init]) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
        const method = init?.method ?? "GET";
        return (
          method === "GET" &&
          (url === "http://example.test/config/providers/registry" ||
            url === "http://example.test/config/providers")
        );
      });
      expect(initialProviderReads).toHaveLength(2);

      const addProviderButton = getByTestId<HTMLButtonElement>(
        page.container,
        "providers-add-open",
      );
      await act(async () => {
        addProviderButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });

      const dialog = getByTestId<HTMLElement>(document.body, "providers-account-dialog");
      const displayNameInput = getLabeledInput(dialog, "Display name");

      act(() => {
        setNativeValue(displayNameInput, "Team account");
      });
      expect(displayNameInput.value).toBe("Team account");

      await act(async () => {
        vi.advanceTimersByTime(1_000);
        await Promise.resolve();
      });
      await flush();
      await flush();

      const providerReadsAfterTick = fetchMock.mock.calls.filter(([input, init]) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
        const method = init?.method ?? "GET";
        return (
          method === "GET" &&
          (url === "http://example.test/config/providers/registry" ||
            url === "http://example.test/config/providers")
        );
      });
      expect(providerReadsAfterTick).toHaveLength(2);
      expect(displayNameInput.value).toBe("Team account");
    } finally {
      cleanupAdminHttpPage(page);
      core.elevatedModeStore.dispose();
    }
  });
});
