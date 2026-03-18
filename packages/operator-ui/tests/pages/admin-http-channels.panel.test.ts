// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupAdminHttpPage,
  createAdminHttpTestCore,
  flush,
  renderAdminHttpConfigurePage,
  switchHttpTab,
  waitForTestId,
} from "./admin-page.http.test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ConfigurePage (HTTP) channels panel states", () => {
  it("shows the empty state when no channel accounts are configured", async () => {
    const { core } = createAdminHttpTestCore();
    core.http.channelConfig.listChannels = vi.fn(async () => ({
      status: "ok",
      channels: [],
    }));

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await waitForTestId(page.container, "admin-http-channels");

    expect(page.container.textContent).toContain("No channel accounts configured");
    expect(page.container.textContent).toContain(
      "Add Telegram, Discord, or Google Chat accounts from the unified setup flow.",
    );

    cleanupAdminHttpPage(page);
  });

  it("surfaces an unavailable channels API", async () => {
    const { core } = createAdminHttpTestCore();
    (core.http as Record<string, unknown>).channelConfig = undefined;

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-routing-config");
    await waitForTestId(page.container, "admin-http-channels");
    await flush();

    expect(page.container.textContent).toContain("Unable to load channels");
    expect(page.container.textContent).toContain("HTTP request failed");

    cleanupAdminHttpPage(page);
  });
});
