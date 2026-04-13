// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setNativeValue } from "../test-utils.js";
import { DETAILED_TOOL_REGISTRY_FIXTURE } from "./admin-http-tools.test-fixtures.js";
import {
  cleanupAdminHttpPage,
  click,
  clickAndFlush,
  createAdminHttpTestCore,
  flush,
  getByTestId,
  renderAdminHttpConfigurePage,
  switchHttpTab,
} from "./admin-page.http.test-support.js";

vi.mock("qrcode", () => ({
  default: {
    toString: async () => "<svg />",
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP) tools", () => {
  it("renders the grouped tool registry", async () => {
    const { core } = createAdminHttpTestCore();
    vi.mocked(core.admin.toolRegistry.list).mockResolvedValue(
      DETAILED_TOOL_REGISTRY_FIXTURE as never,
    );

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-tools");
    await flush();

    expect(page.container.querySelector("[data-testid='admin-http-tools']")).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-skills-note']"),
    ).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-built_in']"),
    ).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-extensions']"),
    ).not.toBeNull();
    expect(page.container.textContent).toContain("tool.browser.navigate");
    expect(page.container.textContent).toContain("tool.node.capability.get");
    expect(page.container.textContent).toContain("tool.automation.schedule.list");
    expect(page.container.textContent).toContain("tool.location.place.list");
    expect(page.container.textContent).toContain("read");
    expect(page.container.textContent).toContain("sandbox.current");
    expect(page.container.textContent).toContain("websearch");
    expect(page.container.textContent).toContain("mcp.exa.web_search_exa");
    expect(page.container.textContent).toContain("plugin.echo.invalid");
    expect(page.container.textContent).toContain("plugin.echo.say");
    expect(page.container.textContent).toContain("Blocked by invalid schema");
    expect(page.container.textContent).toContain("Blocked by agent allowlist");
    expect(page.container.textContent).toContain("Skills are managed separately");

    cleanupAdminHttpPage(page);
  });

  it("filters tools and renders structured schema details", async () => {
    const { core } = createAdminHttpTestCore();
    vi.mocked(core.admin.toolRegistry.list).mockResolvedValue(
      DETAILED_TOOL_REGISTRY_FIXTURE as never,
    );

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-tools");
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "admin-http-tools-filter-source-plugin"));
    await flush();

    expect(page.container.textContent).toContain("plugin.echo.say");
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-built_in']"),
    ).toBeNull();

    click(getByTestId<HTMLButtonElement>(page.container, "admin-http-tools-filter-source-all"));
    await flush();

    click(
      getByTestId<HTMLButtonElement>(
        page.container,
        "admin-http-tools-filter-exposure-disabled_invalid_schema",
      ),
    );
    await flush();

    expect(page.container.textContent).toContain("plugin.echo.invalid");
    expect(page.container.textContent).not.toContain("plugin.echo.say");

    click(getByTestId<HTMLButtonElement>(page.container, "admin-http-tools-filter-exposure-all"));
    await flush();

    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "admin-http-tools-filter"),
        "tool.browser.navigate",
      );
    });
    await flush();

    expect(page.container.textContent).toContain("tool.browser.navigate");
    expect(page.container.textContent).not.toContain("plugin.echo.say");

    await clickAndFlush(
      getByTestId<HTMLButtonElement>(
        page.container,
        "admin-http-tools-toggle-tool.browser.navigate",
      ),
    );

    const details = getByTestId<HTMLElement>(
      page.container,
      "admin-http-tools-details-tool.browser.navigate",
    );
    expect(details.textContent).toContain("Input fields");
    expect(details.textContent).toContain("url");
    expect(details.textContent).toContain("node_id");
    expect(details.textContent).toContain("timeout_ms");
    expect(details.textContent).toContain("Optional dispatch timeout in milliseconds.");

    cleanupAdminHttpPage(page);
  });
});
