// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { stubAdminHttpFetch } from "../admin-http-fetch-test-support.js";
import { setNativeValue } from "../test-utils.js";
import { ADMIN_HTTP_EXECUTION_PROFILE_IDS } from "./admin-page.http.models.shared.js";
import { setupFirstAssignmentSaveScenario } from "./admin-page.http.models.test-support.js";
import {
  TEST_TIMESTAMP,
  cleanupAdminHttpPage,
  clickAndFlush,
  createAdminHttpTestCore,
  expectAuthorizedJsonRequest,
  flush,
  getByTestId,
  jsonResponse,
  openModelsTab,
  renderAdminHttpConfigurePage,
  setSelectValue,
  switchHttpTab,
  waitForEnabledTestId,
  waitForTestId,
} from "./admin-page.http.test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP)", () => {
  it("renders Channels and Secrets panels", async () => {
    const { core } = createAdminHttpTestCore();
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    expect(page.container.querySelector("[data-testid='admin-http-channels']")).not.toBeNull();
    expect(page.container.querySelector("[data-testid='admin-http-routing-config']")).toBeNull();

    await switchHttpTab(page.container, "admin-http-tab-secrets");
    expect(page.container.querySelector("[data-testid='admin-http-secrets']")).not.toBeNull();

    cleanupAdminHttpPage(page);
  });

  it("renders the tool registry tab and lists registered tools", async () => {
    const { core } = createAdminHttpTestCore();
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-tools");
    await flush();

    expect(page.container.querySelector("[data-testid='admin-http-tools']")).not.toBeNull();
    expect(page.container.textContent).toContain("read");
    expect(page.container.textContent).toContain("websearch");
    expect(page.container.textContent).toContain("plugin.echo.say");
    expect(page.container.textContent).toContain("Blocked by agent allowlist");

    cleanupAdminHttpPage(page);
  });

  it("enables saving the first execution-profile assignment set", async () => {
    const { core } = createAdminHttpTestCore();
    const { presetReview } = setupFirstAssignmentSaveScenario(core);

    const page = renderAdminHttpConfigurePage(core);
    await openModelsTab(page.container);

    const selects = Array.from(page.container.querySelectorAll<HTMLSelectElement>("select"));
    expect(selects).toHaveLength(ADMIN_HTTP_EXECUTION_PROFILE_IDS.length);

    const saveButton = getByTestId<HTMLButtonElement>(page.container, "models-assignments-save");
    expect(saveButton.disabled).toBe(true);

    for (const select of selects) {
      setSelectValue(select, presetReview.preset_key);
    }

    expect(saveButton.disabled).toBe(false);
    cleanupAdminHttpPage(page);
  });
});

describe("ConfigurePage (HTTP) channels", () => {
  it("loads the unified Channels panel and configured account cards", async () => {
    const { core } = createAdminHttpTestCore();
    stubAdminHttpFetch(core);
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await waitForTestId(page.container, "admin-http-channels");
    await waitForTestId(page.container, "channels-account-card-telegram-default");

    expect(page.container.textContent).toContain("Account config is the source of truth");
    expect(page.container.textContent).toContain("Friendly usernames or labels resolve");
    expect(page.container.textContent).toContain("default");
    expect(page.container.textContent).toContain("ops");

    cleanupAdminHttpPage(page);
  });

  it("switches Google Chat auth fields dynamically in the registry-driven dialog", async () => {
    const { core } = createAdminHttpTestCore();
    stubAdminHttpFetch(core);
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(page.container, "channels-add-open"),
    );

    const dialog = await waitForTestId<HTMLElement>(document.body, "channels-account-dialog");
    setSelectValue(
      getByTestId<HTMLSelectElement>(dialog, "channels-account-channel"),
      "googlechat",
    );
    await flush();

    expect(
      dialog.querySelector("[data-testid='channels-account-field-service_account_file']"),
    ).not.toBeNull();
    expect(
      dialog.querySelector("[data-testid='channels-account-field-service_account_json']"),
    ).toBeNull();

    setSelectValue(
      getByTestId<HTMLSelectElement>(dialog, "channels-account-field-auth_method"),
      "inline_json",
    );
    await flush();

    expect(
      dialog.querySelector("[data-testid='channels-account-field-service_account_file']"),
    ).toBeNull();
    expect(
      dialog.querySelector("[data-testid='channels-account-field-service_account_json']"),
    ).not.toBeNull();

    cleanupAdminHttpPage(page);
  });

  it("creates a Discord account through the dynamic channel form", async () => {
    const { core } = createAdminHttpTestCore();
    const nextChannels = {
      status: "ok" as const,
      channels: [
        {
          channel: "discord",
          name: "Discord",
          doc: null,
          supported: true,
          configurable: true,
          accounts: [
            {
              channel: "discord",
              account_key: "community",
              config: {
                agent_key: "agent-b",
                allowed_user_ids: ["100"],
                allowed_channels: ["guild:1/channel:2"],
              },
              configured_secret_keys: ["bot_token"],
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
          channel: "discord",
          account_key: "community",
          config: {
            allowed_user_ids: "@alice",
            allowed_channels: "My Server/#general",
            agent_key: "agent-b",
          },
          secrets: {
            bot_token: "discord-bot-token",
          },
        },
      });
      core.admin.channelConfig.listChannels = vi.fn(async () => nextChannels);
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
    setSelectValue(getByTestId<HTMLSelectElement>(dialog, "channels-account-channel"), "discord");
    setNativeValue(
      getByTestId<HTMLInputElement>(dialog, "channels-account-account-key"),
      "community",
    );
    setNativeValue(
      getByTestId<HTMLInputElement>(dialog, "channels-account-field-bot_token"),
      "discord-bot-token",
    );
    setNativeValue(
      getByTestId<HTMLTextAreaElement>(dialog, "channels-account-field-allowed_user_ids"),
      "@alice",
    );
    setNativeValue(
      getByTestId<HTMLTextAreaElement>(dialog, "channels-account-field-allowed_channels"),
      "My Server/#general",
    );
    setSelectValue(
      getByTestId<HTMLSelectElement>(dialog, "channels-account-field-agent_key"),
      "agent-b",
    );
    await flush();

    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(dialog, "channels-account-save"),
    );
    await waitForTestId(page.container, "channels-account-card-discord-community");

    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(page.container.textContent).toContain("community");

    cleanupAdminHttpPage(page);
  });
});
