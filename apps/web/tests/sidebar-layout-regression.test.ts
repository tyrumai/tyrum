import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, "..");
const VITE_CONFIG = resolve(APP_ROOT, "vite.config.ts");

let browser: Browser;
let server: ViteDevServer;
let baseUrl: string;
const originalCwd = process.cwd();

async function assertNoInternalHorizontalClipping(page: Page, selectors: string[]): Promise<void> {
  const result = await page.evaluate((candidateSelectors) => {
    return candidateSelectors.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) {
        return { selector, found: false, clippedBy: null };
      }
      return {
        selector,
        found: true,
        clippedBy: Math.max(0, element.scrollWidth - element.clientWidth),
      };
    });
  }, selectors);

  for (const measurement of result) {
    expect(measurement.found, `${measurement.selector} should exist`).toBe(true);
    expect(
      measurement.clippedBy,
      `${measurement.selector} clipped ${measurement.clippedBy}px of horizontal content`,
    ).toBeLessThanOrEqual(1);
  }
}

describe("sidebar layout regression harness", () => {
  beforeAll(async () => {
    process.chdir(APP_ROOT);
    server = await createServer({
      configFile: VITE_CONFIG,
      logLevel: "error",
      server: {
        host: "127.0.0.1",
        port: 0,
      },
    });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const devOrigin = server.resolvedUrls?.local[0]?.replace(/\/$/, "");
    if (!devOrigin) {
      throw new Error("Dev server did not expose a local URL.");
    }
    baseUrl = `${devOrigin}/layout-harness.html`;
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    await server?.close();
    process.chdir(originalCwd);
  }, 120_000);

  it(
    "does not clip the sidebar when the secondary node section is visible",
    { timeout: 30_000 },
    async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      try {
        await page.goto(`${baseUrl}?route=dashboard`, { waitUntil: "load" });
        await page.waitForSelector('[data-testid="sidebar-secondary-label"]');

        await assertNoInternalHorizontalClipping(page, [
          '[data-testid="sidebar-nav"]',
          '[data-testid="sidebar-secondary-label"]',
        ]);

        const overflowBy = await page
          .locator('[data-testid="sidebar-secondary-label"]')
          .evaluate((label) => {
            const nav = label.closest<HTMLElement>('[data-testid="sidebar-nav"]');
            if (!nav) {
              return Number.NaN;
            }
            return Math.max(
              0,
              label.getBoundingClientRect().right - nav.getBoundingClientRect().right,
            );
          });

        expect(overflowBy).toBeLessThanOrEqual(1);
      } finally {
        await page.close();
      }
    },
  );
});
