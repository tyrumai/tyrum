// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubAdminHttpFetch } from "../admin-http-fetch-test-support.js";
import { setNativeValue } from "../test-utils.js";
import { ADMIN_HTTP_EXECUTION_PROFILE_IDS } from "./admin-page.http.models.shared.js";
import { setupFirstAssignmentSaveScenario } from "./admin-page.http.models.test-support.js";
import {
  cleanupAdminHttpPage,
  click,
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
  waitForQuerySelector,
  waitForTestId,
} from "./admin-page.http.test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP)", () => {
  it("renders Routing config and Secrets panels", async () => {
    const { core } = createAdminHttpTestCore();
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    expect(
      page.container.querySelector("[data-testid='admin-http-routing-config']"),
    ).not.toBeNull();

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

describe("ConfigurePage (HTTP) routing config", () => {
  it("filters structured routing rules", async () => {
    const { core } = createAdminHttpTestCore();
    stubAdminHttpFetch(core);
    const page = renderAdminHttpConfigurePage(core);

    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await waitForQuerySelector<HTMLButtonElement>(
      page.container,
      '[aria-label="Remove Support room"]',
    );

    expect(page.container.textContent).toContain("Support room");

    act(() => {
      setNativeValue(getByTestId<HTMLInputElement>(page.container, "channels-filter"), "missing");
    });
    await flush();

    expect(page.container.textContent).toContain("No routing rules match the current filter");
    cleanupAdminHttpPage(page);
  });

  it("adds a thread override from the structured dialog", async () => {
    const { core, routingConfigUpdate } = createAdminHttpTestCore();
    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/routing/config",
        method: "PUT",
        body: {
          config: {
            v: 1,
            telegram: {
              accounts: {
                default: {
                  default_agent_key: "default",
                  threads: { "tg-123": "agent-b" },
                },
                ops: {
                  threads: { "tg-123": "default" },
                },
              },
            },
          },
        },
      });
      return jsonResponse({ revision: 2, config: { v: 1 } }, 201);
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    const addRuleButton = await waitForEnabledTestId<HTMLButtonElement>(
      page.container,
      "channels-add-open",
    );

    click(addRuleButton);
    const dialog = await waitForTestId<HTMLElement>(document.body, "channels-rule-dialog");
    setSelectValue(getByTestId<HTMLSelectElement>(dialog, "channels-rule-kind"), "thread");
    setSelectValue(
      getByTestId<HTMLSelectElement>(dialog, "channels-rule-thread"),
      JSON.stringify(["ops", "tg-123"]),
    );
    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(dialog, "channels-rule-save"),
    );
    await flush();

    expect(routingConfigUpdate).toHaveBeenCalledTimes(0);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });

  it("adds an account-scoped default route from the structured dialog", async () => {
    const { core } = createAdminHttpTestCore();
    const originalListChannelConfigs = core.http.routingConfig.listChannelConfigs;
    core.http.routingConfig.listChannelConfigs = vi.fn(async () => {
      await Promise.resolve();
      await Promise.resolve();
      return await originalListChannelConfigs();
    });
    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/routing/config",
        method: "PUT",
        body: {
          config: {
            v: 1,
            telegram: {
              accounts: {
                default: {
                  default_agent_key: "default",
                  threads: { "tg-123": "agent-b" },
                },
                ops: {
                  default_agent_key: "default",
                },
              },
            },
          },
        },
      });
      return jsonResponse({ revision: 2, config: { v: 1 } }, 201);
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    const addRuleButton = await waitForEnabledTestId<HTMLButtonElement>(
      page.container,
      "channels-add-open",
    );

    click(addRuleButton);
    const dialog = await waitForTestId<HTMLElement>(document.body, "channels-rule-dialog");
    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(dialog, "channels-rule-save"),
    );

    expect(writeSpy).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });

  it("removes a routing rule via the row action", async () => {
    const { core, routingConfigUpdate } = createAdminHttpTestCore();
    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/routing/config",
        method: "PUT",
        body: {
          config: {
            v: 1,
            telegram: {
              accounts: {
                default: {
                  default_agent_key: "default",
                },
              },
            },
          },
        },
      });
      return jsonResponse({ revision: 2, config: { v: 1 } }, 201);
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    click(
      await waitForQuerySelector<HTMLButtonElement>(
        page.container,
        '[aria-label="Remove Support room"]',
      ),
    );
    const confirmDialog = await waitForTestId<HTMLElement>(document.body, "confirm-danger-dialog");
    click(getByTestId<HTMLElement>(confirmDialog, "confirm-danger-checkbox"));
    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(confirmDialog, "confirm-danger-confirm"),
    );
    await flush();

    expect(routingConfigUpdate).toHaveBeenCalledTimes(0);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });

  it("reverts from the structured history table", async () => {
    const { core, routingConfigRevert } = createAdminHttpTestCore();
    const { writeSpy } = stubAdminHttpFetch(core, async (input: RequestInfo | URL, init) => {
      expectAuthorizedJsonRequest(input, init, {
        url: "http://example.test/routing/config/revert",
        method: "POST",
        body: { revision: 1 },
      });
      return jsonResponse({ revision: 2, config: { v: 1 } }, 201);
    });

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    click(
      await waitForQuerySelector<HTMLButtonElement>(
        page.container,
        '[aria-label="Revert to revision 1"]',
      ),
    );
    const confirmDialog = await waitForTestId<HTMLElement>(document.body, "confirm-danger-dialog");
    click(getByTestId<HTMLElement>(confirmDialog, "confirm-danger-checkbox"));
    await clickAndFlush(
      await waitForEnabledTestId<HTMLButtonElement>(confirmDialog, "confirm-danger-confirm"),
    );
    await flush();

    expect(routingConfigRevert).toHaveBeenCalledTimes(0);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });
});
