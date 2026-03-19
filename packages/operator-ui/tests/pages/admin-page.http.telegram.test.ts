// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { stubAdminHttpFetch } from "../admin-http-fetch-test-support.js";
import { setNativeValue } from "../test-utils.js";
import {
  TEST_TIMESTAMP,
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
  waitForEnabledTestId,
  waitForQuerySelector,
  waitForTestId,
} from "./admin-page.http.test-support.js";

function setSelectValue(element: HTMLSelectElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP) Telegram channels", () => {
  it("shows polling error details on configured Telegram accounts", async () => {
    const { core } = createAdminHttpTestCore();
    stubAdminHttpFetch(core);
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-routing-config");

    expect(page.container.textContent).toContain("Telegram polling issue");
    expect(page.container.textContent).toContain("poll failed");
    expect(page.container.textContent).toContain(`Last error at ${TEST_TIMESTAMP}`);

    cleanupAdminHttpPage(page);
  });

  it("shows Telegram setup guidance in the unified edit dialog", async () => {
    const { core } = createAdminHttpTestCore();
    stubAdminHttpFetch(core);
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await clickAndFlush(
      await waitForQuerySelector<HTMLButtonElement>(
        page.container,
        '[aria-label="Edit telegram default"]',
      ),
    );

    const dialog = await waitForTestId<HTMLElement>(document.body, "channels-account-dialog");
    expect(dialog.textContent).toContain("@BotFather");
    expect(dialog.textContent).toContain("message.from.id");
    expect(dialog.textContent).toContain("Long polling is the default");
    expect(dialog.textContent).toContain("Add yourself to the allowlist first");

    cleanupAdminHttpPage(page);
  });

  it("creates a Telegram account from the unified channel flow", async () => {
    const { core } = createAdminHttpTestCore();
    const nextChannels = {
      status: "ok" as const,
      channels: [
        {
          channel: "telegram",
          name: "Telegram",
          doc: null,
          supported: true,
          configurable: true,
          accounts: [
            {
              channel: "telegram",
              account_key: "alerts",
              config: {
                agent_key: "default",
                ingress_mode: "webhook",
                allowed_user_ids: ["9001", "9002"],
                pipeline_enabled: true,
                polling_status: "idle",
                polling_last_error_at: null,
                polling_last_error_message: null,
              },
              configured_secret_keys: ["bot_token", "webhook_secret"],
              created_at: TEST_TIMESTAMP,
              updated_at: TEST_TIMESTAMP,
            },
          ],
        },
      ],
    };

    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/config/channels/accounts",
        method: "POST",
        body: {
          channel: "telegram",
          account_key: "alerts",
          config: {
            allowed_user_ids: "9001\n9002",
            agent_key: "default",
            ingress_mode: "webhook",
            pipeline_enabled: true,
          },
          secrets: {
            bot_token: "alerts-bot-token",
            webhook_secret: "alerts-webhook-secret",
          },
        },
      });
      core.http.channelConfig.listChannels = vi.fn(async () => nextChannels);
      return jsonResponse(
        {
          status: "ok",
          account: nextChannels.channels[0]?.accounts[0],
        },
        201,
      );
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(page.container, "channels-add-open"),
    );

    const dialog = await waitForTestId<HTMLElement>(document.body, "channels-account-dialog");
    setNativeValue(getByTestId<HTMLInputElement>(dialog, "channels-account-account-key"), "alerts");
    setSelectValue(
      getByTestId<HTMLSelectElement>(dialog, "channels-account-field-ingress_mode"),
      "webhook",
    );
    await flush();
    setNativeValue(
      getByTestId<HTMLInputElement>(dialog, "channels-account-field-bot_token"),
      "alerts-bot-token",
    );
    setNativeValue(
      getByTestId<HTMLInputElement>(dialog, "channels-account-field-webhook_secret"),
      "alerts-webhook-secret",
    );
    setNativeValue(
      getByTestId<HTMLTextAreaElement>(dialog, "channels-account-field-allowed_user_ids"),
      "9001\n9002",
    );
    await flush();

    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(dialog, "channels-account-save"),
    );
    await flush();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });

  it("defaults new Telegram accounts to polling and does not send a webhook secret", async () => {
    const { core } = createAdminHttpTestCore();
    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/config/channels/accounts",
        method: "POST",
        body: {
          channel: "telegram",
          account_key: "alerts",
          config: {
            agent_key: "default",
            ingress_mode: "polling",
            pipeline_enabled: true,
          },
          secrets: {
            bot_token: "alerts-bot-token",
          },
        },
      });
      return jsonResponse(
        {
          status: "ok",
          account: {
            channel: "telegram",
            account_key: "alerts",
            config: {
              agent_key: "default",
              ingress_mode: "polling",
              allowed_user_ids: [],
              pipeline_enabled: true,
              polling_status: "idle",
              polling_last_error_at: null,
              polling_last_error_message: null,
            },
            configured_secret_keys: ["bot_token"],
            created_at: TEST_TIMESTAMP,
            updated_at: TEST_TIMESTAMP,
          },
        },
        201,
      );
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(page.container, "channels-add-open"),
    );

    const dialog = await waitForTestId<HTMLElement>(document.body, "channels-account-dialog");
    setNativeValue(getByTestId<HTMLInputElement>(dialog, "channels-account-account-key"), "alerts");
    setNativeValue(
      getByTestId<HTMLInputElement>(dialog, "channels-account-field-bot_token"),
      "alerts-bot-token",
    );
    await flush();

    expect(
      dialog.querySelector("[data-testid='channels-account-field-webhook_secret']"),
    ).toBeNull();

    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(dialog, "channels-account-save"),
    );

    expect(writeSpy).toHaveBeenCalledOnce();
    cleanupAdminHttpPage(page);
  });

  it("updates a Telegram account while preserving required saved secrets", async () => {
    const { core } = createAdminHttpTestCore();
    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/config/channels/accounts/telegram/default",
        method: "PATCH",
        body: {
          config: {
            allowed_user_ids: "123\n456",
            agent_key: "default",
            ingress_mode: "webhook",
            pipeline_enabled: false,
          },
          secrets: {
            bot_token: "typed-then-cleared-bot-token",
            webhook_secret: "typed-then-cleared-webhook-secret",
          },
          clear_secret_keys: [],
        },
      });
      return jsonResponse({
        status: "ok",
        account: {
          channel: "telegram",
          account_key: "default",
          config: {
            agent_key: "default",
            ingress_mode: "webhook",
            allowed_user_ids: ["123", "456"],
            pipeline_enabled: false,
            polling_status: "idle",
            polling_last_error_at: null,
            polling_last_error_message: null,
          },
          configured_secret_keys: ["bot_token", "webhook_secret"],
          created_at: TEST_TIMESTAMP,
          updated_at: TEST_TIMESTAMP,
        },
      });
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await clickAndFlush(
      await waitForQuerySelector<HTMLButtonElement>(
        page.container,
        '[aria-label="Edit telegram default"]',
      ),
    );

    const dialog = await waitForTestId<HTMLElement>(document.body, "channels-account-dialog");
    setSelectValue(
      getByTestId<HTMLSelectElement>(dialog, "channels-account-field-ingress_mode"),
      "webhook",
    );
    await flush();
    setNativeValue(
      getByTestId<HTMLInputElement>(dialog, "channels-account-field-bot_token"),
      "typed-then-cleared-bot-token",
    );
    setNativeValue(
      getByTestId<HTMLInputElement>(dialog, "channels-account-field-webhook_secret"),
      "typed-then-cleared-webhook-secret",
    );
    setNativeValue(
      getByTestId<HTMLTextAreaElement>(dialog, "channels-account-field-allowed_user_ids"),
      "123\n456",
    );
    await flush();

    click(getByTestId<HTMLElement>(dialog, "channels-account-field-pipeline_enabled"));
    await flush();

    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(dialog, "channels-account-save"),
    );

    expect(writeSpy).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });

  it("preserves the saved webhook secret when switching a Telegram account to polling", async () => {
    const { core } = createAdminHttpTestCore();
    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/config/channels/accounts/telegram/default",
        method: "PATCH",
        body: {
          config: {
            agent_key: "default",
            ingress_mode: "polling",
            pipeline_enabled: true,
          },
          clear_secret_keys: [],
        },
      });
      return jsonResponse({
        status: "ok",
        account: {
          channel: "telegram",
          account_key: "default",
          config: {
            agent_key: "default",
            ingress_mode: "polling",
            allowed_user_ids: ["123"],
            pipeline_enabled: true,
            polling_status: "running",
            polling_last_error_at: null,
            polling_last_error_message: null,
          },
          configured_secret_keys: ["bot_token", "webhook_secret"],
          created_at: TEST_TIMESTAMP,
          updated_at: TEST_TIMESTAMP,
        },
      });
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await clickAndFlush(
      await waitForQuerySelector<HTMLButtonElement>(
        page.container,
        '[aria-label="Edit telegram default"]',
      ),
    );

    const dialog = await waitForTestId<HTMLElement>(document.body, "channels-account-dialog");
    setSelectValue(
      getByTestId<HTMLSelectElement>(dialog, "channels-account-field-ingress_mode"),
      "webhook",
    );
    await flush();
    setSelectValue(
      getByTestId<HTMLSelectElement>(dialog, "channels-account-field-ingress_mode"),
      "polling",
    );
    await flush();

    expect(
      dialog.querySelector("[data-testid='channels-account-field-webhook_secret']"),
    ).toBeNull();

    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(dialog, "channels-account-save"),
    );

    expect(writeSpy).toHaveBeenCalledOnce();
    cleanupAdminHttpPage(page);
  });

  it("deletes a configured Telegram account", async () => {
    const { core } = createAdminHttpTestCore();
    const nextChannels = {
      status: "ok" as const,
      channels: [
        {
          channel: "telegram",
          name: "Telegram",
          doc: null,
          supported: true,
          configurable: true,
          accounts: [
            {
              channel: "telegram",
              account_key: "default",
              config: {
                agent_key: "default",
                allowed_user_ids: ["123"],
                pipeline_enabled: true,
              },
              configured_secret_keys: ["bot_token", "webhook_secret"],
              created_at: TEST_TIMESTAMP,
              updated_at: TEST_TIMESTAMP,
            },
          ],
        },
      ],
    };

    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expect(String(input)).toBe("http://example.test/config/channels/accounts/telegram/ops");
      expect(init?.method).toBe("DELETE");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-elevated-token");
      core.http.channelConfig.listChannels = vi.fn(async () => nextChannels);
      return jsonResponse({
        status: "ok",
        deleted: true,
        channel: "telegram",
        account_key: "ops",
      });
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await clickAndFlush(
      await waitForQuerySelector<HTMLButtonElement>(
        page.container,
        '[aria-label="Delete telegram ops"]',
      ),
    );

    const confirmDialog = await waitForTestId<HTMLElement>(document.body, "confirm-danger-dialog");
    click(getByTestId<HTMLElement>(confirmDialog, "confirm-danger-checkbox"));
    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(confirmDialog, "confirm-danger-confirm"),
    );
    await flush();

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(
      page.container.querySelector("[data-testid='channels-account-card-telegram-ops']"),
    ).toBeNull();
    cleanupAdminHttpPage(page);
  });
});
