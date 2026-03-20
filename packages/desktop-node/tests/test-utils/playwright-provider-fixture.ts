import type { ActionPrimitive } from "@tyrum/contracts";
import {
  PlaywrightProvider,
  type PlaywrightProviderConfig,
} from "../../src/providers/playwright-provider.js";
import { MockPlaywrightBackend } from "./mock-playwright-backend.js";

export function makeAction(args: Record<string, unknown>): ActionPrimitive {
  return { type: "Web", args };
}

export function makeProvider(
  overrides: Partial<PlaywrightProviderConfig> = {},
  backend: MockPlaywrightBackend = new MockPlaywrightBackend(),
) {
  const config: PlaywrightProviderConfig = {
    allowedDomains: ["example.com", "trusted.org"],
    headless: true,
    domainRestricted: true,
    ...overrides,
  };
  return { provider: new PlaywrightProvider(config, backend), backend };
}

export class RedirectingMockBackend extends MockPlaywrightBackend {
  currentUrl = "https://example.com";
  navigateRedirectUrl: string | null = null;
  clickRedirectUrl: string | null = null;
  fillRedirectUrl: string | null = null;

  override async navigate(url: string): Promise<{ title: string; url: string }> {
    this.calls.push({ method: "navigate", args: [url] });
    this.currentUrl = this.navigateRedirectUrl ?? url;
    return { title: "Mock Page", url: this.currentUrl };
  }

  override async click(selector: string): Promise<void> {
    this.calls.push({ method: "click", args: [selector] });
    if (this.clickRedirectUrl) this.currentUrl = this.clickRedirectUrl;
  }

  override async fill(selector: string, value: string): Promise<void> {
    this.calls.push({ method: "fill", args: [selector, value] });
    if (this.fillRedirectUrl) this.currentUrl = this.fillRedirectUrl;
  }

  override async snapshot() {
    this.calls.push({ method: "snapshot", args: [] });
    return {
      html: "<html><body>mock</body></html>",
      title: "Mock Page",
      url: this.currentUrl,
    };
  }
}
