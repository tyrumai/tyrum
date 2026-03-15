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
  expectPresent,
  flush,
  getByTestId,
  jsonResponse,
  openModelsTab,
  renderAdminHttpConfigurePage,
  setSelectValue,
  switchHttpTab,
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
    await flush();

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
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "channels-add-open"));
    await flush();
    setSelectValue(getByTestId<HTMLSelectElement>(document.body, "channels-rule-kind"), "thread");
    setSelectValue(
      getByTestId<HTMLSelectElement>(document.body, "channels-rule-thread"),
      JSON.stringify(["ops", "tg-123"]),
    );
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "channels-rule-save"));
    await flush();

    expect(routingConfigUpdate).toHaveBeenCalledTimes(0);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });

  it("adds an account-scoped default route from the structured dialog", async () => {
    const { core } = createAdminHttpTestCore();
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
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "channels-add-open"));
    await flush();
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "channels-rule-save"));

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
    await flush();

    click(
      expectPresent(
        page.container.querySelector<HTMLButtonElement>('[aria-label="Remove Support room"]'),
      ),
    );
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
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
    await flush();

    click(
      expectPresent(
        page.container.querySelector<HTMLButtonElement>('[aria-label="Revert to revision 1"]'),
      ),
    );
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
    await flush();

    expect(routingConfigRevert).toHaveBeenCalledTimes(0);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    cleanupAdminHttpPage(page);
  });
});
