import type { PlaywrightBackend, PageSnapshot } from "./playwright-backend.js";

export class RealPlaywrightBackend implements PlaywrightBackend {
  private browser: import("playwright").Browser | null = null;
  private page: import("playwright").Page | null = null;
  private headless: boolean;

  constructor(opts: { headless?: boolean } = {}) {
    this.headless = opts.headless ?? true;
  }

  async ensureBrowser(): Promise<void> {
    if (this.browser?.isConnected() && this.page && !this.page.isClosed()) return;

    // Clean up stale resources
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Browser may already be closed
      }
    }

    let chromium;
    try {
      const pw = await import("playwright");
      chromium = pw.chromium;
    } catch (err) {
      throw new Error(
        `Playwright not available: ${(err as Error).message}. ` +
          `Install with: pnpm add playwright`,
      );
    }

    try {
      this.browser = await chromium.launch({ headless: this.headless });
    } catch (err) {
      throw new Error(
        `Failed to launch browser. Chromium may not be installed. ` +
          `Run: npx playwright install chromium\n` +
          `Original error: ${(err as Error).message}`,
      );
    }

    this.page = await this.browser.newPage();
  }

  async navigate(url: string): Promise<{ title: string; url: string }> {
    if (!this.page) throw new Error("Browser not initialized. Call ensureBrowser() first.");

    await this.page.goto(url, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });

    return {
      title: await this.page.title(),
      url: this.page.url(),
    };
  }

  async click(selector: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    await this.page.locator(selector).click({ timeout: 10_000 });
  }

  async fill(selector: string, value: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    await this.page.locator(selector).fill(value, { timeout: 10_000 });
  }

  async snapshot(): Promise<PageSnapshot> {
    if (!this.page) throw new Error("Browser not initialized");
    return {
      html: await this.page.content(),
      title: await this.page.title(),
      url: this.page.url(),
    };
  }

  async close(): Promise<void> {
    if (this.page) {
      try {
        await this.page.close();
      } catch {
        // Page may already be closed
      }
      this.page = null;
    }
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Browser may already be closed
      }
      this.browser = null;
    }
  }
}
