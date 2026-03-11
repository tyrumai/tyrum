// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setNativeValue } from "../test-utils.js";
import {
  cleanupAdminHttpPage,
  click,
  clickAndFlush,
  createAdminHttpTestCore,
  expectAuthorizedJsonRequest,
  flush,
  getByTestId,
  jsonResponse,
  renderAdminHttpConfigurePage,
  switchHttpTab,
} from "./admin-page.http.test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP) telegram connection", () => {
  it("saves telegram connection settings through a confirmed mutation", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/routing/channels/telegram/config",
        method: "PUT",
        body: {
          bot_token: "new-bot-token",
          allowed_user_ids: ["123", "456"],
          pipeline_enabled: true,
        },
      });
      return jsonResponse({
        revision: 4,
        config: {
          bot_token_configured: true,
          webhook_secret_configured: true,
          allowed_user_ids: ["123", "456"],
          pipeline_enabled: true,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "channels-telegram-bot-token"),
        "new-bot-token",
      );
      setNativeValue(
        getByTestId<HTMLTextAreaElement>(page.container, "channels-telegram-allowed-user-ids"),
        "123\n456",
      );
    });
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "channels-telegram-save-open"));
    await flush();

    expect(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm").disabled).toBe(
      true,
    );

    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });

  it("shows telegram connection save failures in the confirmation dialog", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: "upstream_error",
          message: "telegram config save failed",
        },
        500,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "channels-telegram-bot-token"),
        "new-bot-token",
      );
    });
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "channels-telegram-save-open"));
    await flush();
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("telegram config save failed");
    cleanupAdminHttpPage(page);
  });

  it("prefers clear flags over typed secret values when saving telegram settings", async () => {
    const { core } = createAdminHttpTestCore();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/routing/channels/telegram/config",
        method: "PUT",
        body: {
          clear_bot_token: true,
          clear_webhook_secret: true,
          allowed_user_ids: ["123"],
          pipeline_enabled: true,
        },
      });
      return jsonResponse({
        revision: 4,
        config: {
          bot_token_configured: false,
          webhook_secret_configured: false,
          allowed_user_ids: ["123"],
          pipeline_enabled: true,
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "channels-telegram-bot-token"),
        "typed-then-cleared-bot-token",
      );
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "channels-telegram-webhook-secret"),
        "typed-then-cleared-webhook-secret",
      );
    });
    await flush();

    click(getByTestId<HTMLElement>(page.container, "channels-telegram-clear-bot-token"));
    click(getByTestId<HTMLElement>(page.container, "channels-telegram-clear-webhook-secret"));
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "channels-telegram-save-open"));
    await flush();
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });
});
