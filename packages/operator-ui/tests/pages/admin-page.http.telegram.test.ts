// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubAdminHttpFetch } from "../admin-http-fetch-test-support.js";
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

describe("ConfigurePage (HTTP) channel configs", () => {
  it("renders configured channels collapsed by default and expands an instance inline", async () => {
    const { core } = createAdminHttpTestCore();
    stubAdminHttpFetch(core);
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    expect(page.container.textContent).toContain("Configured channels");
    expect(page.container.textContent).toContain("default");
    expect(
      page.container.querySelector("[data-testid='channels-instance-default-bot-token']"),
    ).toBeNull();

    click(getByTestId<HTMLButtonElement>(page.container, "channels-instance-toggle-default"));
    await flush();

    expect(
      page.container.querySelector("[data-testid='channels-instance-default-bot-token']"),
    ).not.toBeNull();
    cleanupAdminHttpPage(page);
  });

  it("adds a Telegram channel from the top-level add action", async () => {
    const { core } = createAdminHttpTestCore();
    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/routing/channels/configs",
        method: "POST",
        body: {
          channel: "telegram",
          account_key: "alerts",
          bot_token: "alerts-bot-token",
          webhook_secret: "alerts-webhook-secret",
          allowed_user_ids: ["9001", "9002"],
          pipeline_enabled: false,
        },
      });
      return jsonResponse(
        {
          config: {
            channel: "telegram",
            account_key: "alerts",
            bot_token_configured: true,
            webhook_secret_configured: true,
            allowed_user_ids: ["9001", "9002"],
            pipeline_enabled: false,
          },
        },
        201,
      );
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "channels-instance-add-open"));
    await flush();

    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(document.body, "channels-instance-create-account-key"),
        "alerts",
      );
      setNativeValue(
        getByTestId<HTMLInputElement>(document.body, "channels-instance-create-bot-token"),
        "alerts-bot-token",
      );
      setNativeValue(
        getByTestId<HTMLInputElement>(document.body, "channels-instance-create-webhook-secret"),
        "alerts-webhook-secret",
      );
      setNativeValue(
        getByTestId<HTMLTextAreaElement>(
          document.body,
          "channels-instance-create-allowed-user-ids",
        ),
        "9001\n9002",
      );
    });
    await flush();

    click(getByTestId<HTMLElement>(document.body, "channels-instance-create-pipeline-enabled"));
    await flush();
    await clickAndFlush(
      getByTestId<HTMLButtonElement>(document.body, "channels-instance-create-save"),
    );

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(page.container.textContent).toContain("alerts");
    cleanupAdminHttpPage(page);
  });

  it("saves an expanded Telegram account and prefers clear flags over typed secrets", async () => {
    const { core } = createAdminHttpTestCore();
    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/routing/channels/configs/telegram/default",
        method: "PATCH",
        body: {
          clear_bot_token: true,
          clear_webhook_secret: true,
          allowed_user_ids: ["123", "456"],
          pipeline_enabled: false,
        },
      });
      return jsonResponse({
        config: {
          channel: "telegram",
          account_key: "default",
          bot_token_configured: false,
          webhook_secret_configured: false,
          allowed_user_ids: ["123", "456"],
          pipeline_enabled: false,
        },
      });
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "channels-instance-toggle-default"));
    await flush();

    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "channels-instance-default-bot-token"),
        "typed-then-cleared-bot-token",
      );
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "channels-instance-default-webhook-secret"),
        "typed-then-cleared-webhook-secret",
      );
      setNativeValue(
        getByTestId<HTMLTextAreaElement>(
          page.container,
          "channels-instance-default-allowed-user-ids",
        ),
        "123\n456",
      );
    });
    await flush();

    click(getByTestId<HTMLElement>(page.container, "channels-instance-default-clear-bot-token"));
    click(
      getByTestId<HTMLElement>(page.container, "channels-instance-default-clear-webhook-secret"),
    );
    click(getByTestId<HTMLElement>(page.container, "channels-instance-default-pipeline-enabled"));
    await flush();

    await clickAndFlush(
      getByTestId<HTMLButtonElement>(page.container, "channels-instance-save-default"),
    );

    expect(writeSpy).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });

  it("deletes a configured Telegram account", async () => {
    const { core } = createAdminHttpTestCore();
    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expect(String(input)).toBe("http://example.test/routing/channels/configs/telegram/ops");
      expect(init?.method).toBe("DELETE");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-elevated-token");
      return jsonResponse({
        deleted: true,
        channel: "telegram",
        account_key: "ops",
      });
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "channels-instance-toggle-ops"));
    await flush();
    click(getByTestId<HTMLButtonElement>(page.container, "channels-instance-delete-open-ops"));
    await flush();
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(page.container.querySelector("[data-testid='channels-instance-card-ops']")).toBeNull();
    cleanupAdminHttpPage(page);
  });
});
