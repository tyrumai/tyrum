import type {
  PageSnapshot,
  PlaywrightBackend,
} from "../../src/main/providers/backends/playwright-backend.js";

export class MockPlaywrightBackend implements PlaywrightBackend {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  private currentUrl = "about:blank";

  async ensureBrowser(): Promise<void> {
    this.calls.push({ method: "ensureBrowser", args: [] });
  }

  async navigate(url: string): Promise<{ title: string; url: string }> {
    this.calls.push({ method: "navigate", args: [url] });
    this.currentUrl = url;
    return { title: "Mock Page", url };
  }

  async click(selector: string): Promise<void> {
    this.calls.push({ method: "click", args: [selector] });
  }

  async fill(selector: string, value: string): Promise<void> {
    this.calls.push({ method: "fill", args: [selector, value] });
  }

  async snapshot(): Promise<PageSnapshot> {
    this.calls.push({ method: "snapshot", args: [] });
    return {
      html: "<html><body>mock</body></html>",
      title: "Mock Page",
      url: this.currentUrl,
    };
  }

  async close(): Promise<void> {
    this.calls.push({ method: "close", args: [] });
  }
}
