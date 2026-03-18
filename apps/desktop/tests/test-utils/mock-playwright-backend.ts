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

  async goBack(): Promise<{ url: string; title?: string }> {
    this.calls.push({ method: "goBack", args: [] });
    return { url: this.currentUrl, title: "Mock Page" };
  }

  async hover(selector: string): Promise<void> {
    this.calls.push({ method: "hover", args: [selector] });
  }

  async drag(sourceSelector: string, targetSelector: string): Promise<void> {
    this.calls.push({ method: "drag", args: [sourceSelector, targetSelector] });
  }

  async type(selector: string, text: string, submit?: boolean): Promise<void> {
    this.calls.push({ method: "type", args: [selector, text, submit] });
  }

  async selectOption(selector: string, values: string[]): Promise<string[]> {
    this.calls.push({ method: "selectOption", args: [selector, values] });
    return values;
  }

  async pressKey(key: string, modifiers?: string[]): Promise<void> {
    this.calls.push({ method: "pressKey", args: [key, modifiers] });
  }

  async screenshot(
    selector?: string,
    fullPage?: boolean,
  ): Promise<{ bytesBase64: string; mime: string; width?: number; height?: number }> {
    this.calls.push({ method: "screenshot", args: [selector, fullPage] });
    return { bytesBase64: "bW9jaw==", mime: "image/png" };
  }

  async evaluate(expression: string): Promise<unknown> {
    this.calls.push({ method: "evaluate", args: [expression] });
    return null;
  }

  async waitFor(options: {
    selector?: string;
    url?: string;
    text?: string;
    timeoutMs?: number;
  }): Promise<boolean> {
    this.calls.push({ method: "waitFor", args: [options] });
    return true;
  }

  async listTabs(): Promise<{
    tabs: Array<{ index: number; url: string; title?: string }>;
    active_index: number;
  }> {
    this.calls.push({ method: "listTabs", args: [] });
    return { tabs: [{ index: 0, url: this.currentUrl, title: "Mock Page" }], active_index: 0 };
  }

  async switchTab(index: number): Promise<void> {
    this.calls.push({ method: "switchTab", args: [index] });
  }

  async uploadFile(selector: string, paths: string[]): Promise<number> {
    this.calls.push({ method: "uploadFile", args: [selector, paths] });
    return paths.length;
  }

  async getConsoleMessages(): Promise<Array<{ type: string; text: string }>> {
    this.calls.push({ method: "getConsoleMessages", args: [] });
    return [];
  }

  async getNetworkRequests(): Promise<
    Array<{ method: string; url: string; status?: number; contentType?: string }>
  > {
    this.calls.push({ method: "getNetworkRequests", args: [] });
    return [];
  }

  async resize(width: number, height: number): Promise<void> {
    this.calls.push({ method: "resize", args: [width, height] });
  }

  async handleDialog(
    accept: boolean,
    promptText?: string,
  ): Promise<{ dialogType?: string; message?: string }> {
    this.calls.push({ method: "handleDialog", args: [accept, promptText] });
    return {};
  }

  async runCode(code: string): Promise<unknown> {
    this.calls.push({ method: "runCode", args: [code] });
    return null;
  }
}
