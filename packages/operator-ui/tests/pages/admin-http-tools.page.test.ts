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
  it("renders canonical groups, tiers, alias state, and visibility metadata", async () => {
    const { core } = createAdminHttpTestCore();
    vi.mocked(core.admin.toolRegistry.list).mockResolvedValue(DETAILED_TOOL_REGISTRY_FIXTURE);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-tools");
    await flush();

    expect(page.container.querySelector("[data-testid='admin-http-tools']")).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-skills-note']"),
    ).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-core']"),
    ).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-memory']"),
    ).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-retrieval']"),
    ).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-environment']"),
    ).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-node']"),
    ).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-orchestration']"),
    ).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-extension']"),
    ).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-unclassified']"),
    ).not.toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-built_in']"),
    ).toBeNull();
    expect(
      page.container.querySelector("[data-testid='admin-http-tools-group-extensions']"),
    ).toBeNull();

    const pageText = page.container.textContent ?? "";
    expect(pageText).toContain("tool.browser.navigate");
    expect(pageText).toContain("tool.node.capability.get");
    expect(pageText).toContain("tool.automation.schedule.list");
    expect(pageText).toContain("tool.location.place.list");
    expect(pageText).toContain("memory.write");
    expect(pageText).toContain("sandbox.current");
    expect(pageText).toContain("connector.send");
    expect(pageText).toContain("guardian_review_decision");
    expect(pageText).toContain("websearch");
    expect(pageText).toContain("mcp.exa.web_search_exa");
    expect(pageText).toContain("plugin.echo.invalid");
    expect(pageText).toContain("plugin.echo.say");
    expect(pageText).toContain("tool.fs.read (Alias)");
    expect(pageText).toContain("mcp.memory.write (Deprecated)");
    expect(pageText).toContain("Internal");
    expect(pageText).toContain("Runtime only");
    expect(pageText).toContain("Deprecated");
    expect(pageText).toContain("Node-backed");
    expect(pageText).toContain("Environment");
    expect(pageText).toContain("Blocked by invalid schema");
    expect(pageText).toContain("Blocked by agent allowlist");
    expect(pageText).toContain("Skills are managed separately");

    cleanupAdminHttpPage(page);
  });

  it("filters by source, exposure, alias, and visibility metadata", async () => {
    const { core } = createAdminHttpTestCore();
    vi.mocked(core.admin.toolRegistry.list).mockResolvedValue(DETAILED_TOOL_REGISTRY_FIXTURE);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-tools");
    await flush();

    click(getByTestId<HTMLButtonElement>(page.container, "admin-http-tools-filter-source-plugin"));
    await flush();

    expect(page.container.textContent).toContain("plugin.echo.say");
    expect(page.container.textContent).not.toContain("tool.browser.navigate");
    expect(page.container.querySelector("[data-testid='admin-http-tools-group-node']")).toBeNull();

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
        "internal",
      );
    });
    await flush();

    expect(page.container.textContent).toContain("sandbox.current");
    expect(page.container.textContent).not.toContain("tool.browser.navigate");

    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "admin-http-tools-filter"),
        "mcp.memory.write",
      );
    });
    await flush();

    expect(page.container.textContent).toContain("memory.write");
    expect(page.container.textContent).not.toContain("sandbox.current");

    cleanupAdminHttpPage(page);
  });

  it("renders finalized details for structured schema, lifecycle, and backing server metadata", async () => {
    const { core } = createAdminHttpTestCore();
    vi.mocked(core.admin.toolRegistry.list).mockResolvedValue(DETAILED_TOOL_REGISTRY_FIXTURE);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-tools");
    await flush();

    await clickAndFlush(
      getByTestId<HTMLButtonElement>(
        page.container,
        "admin-http-tools-toggle-tool.browser.navigate",
      ),
    );

    const browserDetails = getByTestId<HTMLElement>(
      page.container,
      "admin-http-tools-details-tool.browser.navigate",
    );
    expect(browserDetails.textContent).toContain("Input fields");
    expect(browserDetails.textContent).toContain("Group");
    expect(browserDetails.textContent).toContain("Node-backed");
    expect(browserDetails.textContent).toContain("Tier");
    expect(browserDetails.textContent).toContain("Advanced");
    expect(browserDetails.textContent).toContain("Visibility");
    expect(browserDetails.textContent).toContain("Public");
    expect(browserDetails.textContent).toContain("url");
    expect(browserDetails.textContent).toContain("node_id");
    expect(browserDetails.textContent).toContain("timeout_ms");
    expect(browserDetails.textContent).toContain("Optional dispatch timeout in milliseconds.");

    await clickAndFlush(
      getByTestId<HTMLButtonElement>(page.container, "admin-http-tools-toggle-connector.send"),
    );

    const connectorDetails = getByTestId<HTMLElement>(
      page.container,
      "admin-http-tools-details-connector.send",
    );
    expect(connectorDetails.textContent).toContain("Lifecycle");
    expect(connectorDetails.textContent).toContain("Deprecated");
    expect(connectorDetails.textContent).toContain("Visibility");
    expect(connectorDetails.textContent).toContain("Public");
    expect(connectorDetails.textContent).toContain("Group");
    expect(connectorDetails.textContent).toContain("Extensions");

    await clickAndFlush(
      getByTestId<HTMLButtonElement>(
        page.container,
        "admin-http-tools-toggle-mcp.exa.web_search_exa",
      ),
    );

    const mcpDetails = getByTestId<HTMLElement>(
      page.container,
      "admin-http-tools-details-mcp.exa.web_search_exa",
    );
    expect(mcpDetails.textContent).toContain("Shared Exa");
    expect(mcpDetails.textContent).toContain("https://mcp.example.test");
    expect(mcpDetails.textContent).toContain("Blocked by state mode");

    cleanupAdminHttpPage(page);
  });
});
