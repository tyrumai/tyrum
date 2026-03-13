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
    vi.mocked(core.http.toolRegistry.list).mockResolvedValue(
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
    expect(page.container.textContent).toContain("read");
    expect(page.container.textContent).toContain("websearch");
    expect(page.container.textContent).toContain("mcp.exa.web_search_exa");
    expect(page.container.textContent).toContain("plugin.echo.say");
    expect(page.container.textContent).toContain("Blocked by agent allowlist");
    expect(page.container.textContent).toContain("Skills are managed separately");

    cleanupAdminHttpPage(page);
  });

  it("filters tools and renders structured schema details", async () => {
    const { core } = createAdminHttpTestCore();
    vi.mocked(core.http.toolRegistry.list).mockResolvedValue(
      DETAILED_TOOL_REGISTRY_FIXTURE as never,
    );

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-tools");
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "admin-http-tools-filter-source-plugin"));
    await flush();

    expect(page.container.textContent).toContain("plugin.echo.say");
    expect(page.container.textContent).not.toContain("read");
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-built_in']"),
    ).toBeNull();

    click(getByTestId<HTMLButtonElement>(page.container, "admin-http-tools-filter-source-all"));
    await flush();

    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "admin-http-tools-filter"),
        "read",
      );
    });
    await flush();

    expect(page.container.textContent).toContain("read");
    expect(page.container.textContent).not.toContain("plugin.echo.say");

    await clickAndFlush(
      getByTestId<HTMLButtonElement>(page.container, "admin-http-tools-toggle-read"),
    );

    const details = getByTestId<HTMLElement>(page.container, "admin-http-tools-details-read");
    expect(details.textContent).toContain("Input fields");
    expect(details.textContent).toContain("path");
    expect(details.textContent).toContain("options");
    expect(details.textContent).toContain("offset");
    expect(details.textContent).toContain("boolean");
    expect(details.textContent).not.toContain("root");

    cleanupAdminHttpPage(page);
  });
});
