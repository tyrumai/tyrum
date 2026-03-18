import type { PlaywrightBackend, PageSnapshot } from "./playwright-backend.js";

export class RealPlaywrightBackend implements PlaywrightBackend {
  private browser: import("playwright").Browser | null = null;
  private page: import("playwright").Page | null = null;
  private headless: boolean;

  private consoleMessages: Array<{ type: string; text: string }> = [];
  private networkRequests: Array<{
    method: string;
    url: string;
    status?: number;
    contentType?: string;
  }> = [];
  private lastDialog: import("playwright").Dialog | null = null;
  private pendingDialogAction: { accept: boolean; promptText?: string } | null = null;
  private listenedPages = new WeakSet<import("playwright").Page>();

  constructor(opts: { headless?: boolean } = {}) {
    this.headless = opts.headless ?? true;
  }

  async ensureBrowser(): Promise<void> {
    if (this.browser?.isConnected() && this.page && !this.page.isClosed()) return;

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
    }

    this.consoleMessages = [];
    this.networkRequests = [];
    this.lastDialog = null;
    this.pendingDialogAction = null;

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
    this.attachListeners(this.page);
  }

  private attachListeners(page: import("playwright").Page): void {
    if (this.listenedPages.has(page)) return;
    this.listenedPages.add(page);

    page.on("console", (msg) => {
      this.consoleMessages.push({ type: msg.type(), text: msg.text() });
    });

    page.on("request", (req) => {
      this.networkRequests.push({ method: req.method(), url: req.url() });
    });

    page.on("response", (res) => {
      const entry = this.networkRequests.find((r) => r.url === res.url() && r.status === undefined);
      if (entry) {
        entry.status = res.status();
        entry.contentType = res.headers()["content-type"];
      }
    });

    page.on("dialog", (dialog) => {
      if (this.pendingDialogAction) {
        // Auto-handle the dialog and clear state — don't store as lastDialog
        // since it will be dismissed immediately and would be stale.
        const action = this.pendingDialogAction;
        this.pendingDialogAction = null;
        void (action.accept ? dialog.accept(action.promptText) : dialog.dismiss());
      } else {
        this.lastDialog = dialog;
      }
    });
  }

  private getPage(): import("playwright").Page {
    if (!this.page) throw new Error("Browser not initialized. Call ensureBrowser() first.");
    return this.page;
  }

  private getContext(): import("playwright").BrowserContext {
    const page = this.getPage();
    return page.context();
  }

  async navigate(url: string): Promise<{ title: string; url: string }> {
    const page = this.getPage();

    await page.goto(url, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });

    return {
      title: await page.title(),
      url: page.url(),
    };
  }

  async click(selector: string): Promise<void> {
    const page = this.getPage();
    await page.locator(selector).click({ timeout: 10_000 });
  }

  async fill(selector: string, value: string): Promise<void> {
    const page = this.getPage();
    await page.locator(selector).fill(value, { timeout: 10_000 });
  }

  async snapshot(): Promise<PageSnapshot> {
    const page = this.getPage();
    return {
      html: await page.content(),
      title: await page.title(),
      url: page.url(),
    };
  }

  async close(): Promise<void> {
    const browser = this.browser;
    const page = this.page;
    this.browser = null;
    this.page = null;

    if (browser) {
      try {
        await browser.close();
      } catch {}
      return;
    }

    if (page) {
      try {
        await page.close();
      } catch {}
    }
  }

  async goBack(): Promise<{ url: string; title?: string }> {
    const page = this.getPage();
    await page.goBack();
    return { url: page.url(), title: await page.title() };
  }

  async hover(selector: string): Promise<void> {
    const page = this.getPage();
    await page.locator(selector).hover();
  }

  async drag(sourceSelector: string, targetSelector: string): Promise<void> {
    const page = this.getPage();
    await page.locator(sourceSelector).dragTo(page.locator(targetSelector));
  }

  async type(selector: string, text: string, submit?: boolean): Promise<void> {
    const page = this.getPage();
    await page.locator(selector).pressSequentially(text);
    if (submit) await page.locator(selector).press("Enter");
  }

  async selectOption(selector: string, values: string[]): Promise<string[]> {
    const page = this.getPage();
    return page.locator(selector).selectOption(values);
  }

  async pressKey(key: string, modifiers?: string[]): Promise<void> {
    const page = this.getPage();
    const combo = modifiers?.length ? `${modifiers.join("+")}+${key}` : key;
    await page.keyboard.press(combo);
  }

  async screenshot(
    selector?: string,
    fullPage?: boolean,
  ): Promise<{ bytesBase64: string; mime: string; width?: number; height?: number }> {
    const page = this.getPage();
    const buffer = selector
      ? await page.locator(selector).screenshot()
      : await page.screenshot({ fullPage: fullPage ?? false });
    return {
      bytesBase64: buffer.toString("base64"),
      mime: "image/png",
    };
  }

  async evaluate(expression: string): Promise<unknown> {
    const page = this.getPage();
    return page.evaluate(expression);
  }

  async waitFor(options: {
    selector?: string;
    url?: string;
    text?: string;
    timeoutMs?: number;
  }): Promise<boolean> {
    const page = this.getPage();
    const timeout = options.timeoutMs ?? 30_000;
    try {
      if (options.selector) {
        await page.locator(options.selector).waitFor({ timeout });
      } else if (options.url) {
        await page.waitForURL(options.url, { timeout });
      } else if (options.text) {
        await page.locator(`text=${options.text}`).waitFor({ timeout });
      }
      return true;
    } catch {
      return false;
    }
  }

  async listTabs(): Promise<{
    tabs: Array<{ index: number; url: string; title?: string }>;
    activeIndex: number;
  }> {
    const context = this.getContext();
    const pages = context.pages();
    const page = this.getPage();
    const activeIndex = pages.indexOf(page);
    const tabs = await Promise.all(
      pages.map(async (p, index) => ({
        index,
        url: p.url(),
        title: await p.title().catch(() => undefined),
      })),
    );
    return { tabs, activeIndex: activeIndex >= 0 ? activeIndex : 0 };
  }

  async switchTab(index: number): Promise<void> {
    const context = this.getContext();
    const pages = context.pages();
    if (index < 0 || index >= pages.length) throw new Error(`Tab index ${index} out of range`);
    this.page = pages[index]!;
    this.attachListeners(this.page);
    await this.page.bringToFront();
  }

  async uploadFile(selector: string, paths: string[]): Promise<number> {
    const page = this.getPage();
    await page.locator(selector).setInputFiles(paths);
    return paths.length;
  }

  async getConsoleMessages(): Promise<Array<{ type: string; text: string }>> {
    return this.consoleMessages;
  }

  async getNetworkRequests(): Promise<
    Array<{ method: string; url: string; status?: number; contentType?: string }>
  > {
    return this.networkRequests;
  }

  async resize(width: number, height: number): Promise<void> {
    const page = this.getPage();
    await page.setViewportSize({ width, height });
  }

  async handleDialog(
    accept: boolean,
    promptText?: string,
  ): Promise<{ dialogType?: string; message?: string }> {
    const dialog = this.lastDialog;
    if (dialog) {
      const info = { dialogType: dialog.type(), message: dialog.message() };
      try {
        if (accept) {
          await dialog.accept(promptText);
        } else {
          await dialog.dismiss();
        }
      } catch {
        // Dialog may have already been handled
      }
      this.lastDialog = null;
      return info;
    }
    // No dialog currently present; store the intent so the next dialog is auto-handled.
    this.pendingDialogAction = { accept, promptText };
    return {};
  }

  async runCode(code: string): Promise<unknown> {
    const page = this.getPage();
    return page.evaluate(code);
  }
}
