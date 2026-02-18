/** Snapshot of the current browser page state. */
export interface PageSnapshot {
  html: string;
  title: string;
  url: string;
}

/**
 * Low-level browser automation backend.
 *
 * Implementations manage the actual browser lifecycle and page interactions.
 * The provider layer handles domain allowlist checks, arg validation, and
 * evidence formatting.
 */
export interface PlaywrightBackend {
  ensureBrowser(): Promise<void>;
  navigate(url: string): Promise<{ title: string; url: string }>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  snapshot(): Promise<PageSnapshot>;
  close(): Promise<void>;
}

/** Mock backend for tests -- returns plausible fake data, tracks calls. */
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
