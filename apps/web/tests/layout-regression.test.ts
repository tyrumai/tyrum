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

type LayoutCase = {
  name: string;
  route: string;
  clicks?: string[];
  selectors: string[];
};

const cases: LayoutCase[] = [
  {
    name: "dashboard",
    route: "dashboard",
    selectors: ["[data-layout-content]"],
  },
  {
    name: "chat",
    route: "chat",
    selectors: [
      '[data-testid="chat-page"]',
      '[data-testid="chat-panels"]',
      '[data-testid="chat-threads-panel"]',
      '[data-testid="chat-conversation-panel"]',
    ],
  },
  {
    name: "approvals",
    route: "approvals",
    selectors: ["[data-layout-content]"],
  },
  {
    name: "pairing",
    route: "pairing",
    selectors: ["[data-layout-content]"],
  },
  {
    name: "workboard",
    route: "workboard",
    selectors: ["[data-layout-content]", '[data-testid="workboard-board"]'],
  },
  {
    name: "agents identity",
    route: "agents",
    selectors: ['[data-testid="agents-content-layout"]', '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "agents editor",
    route: "agents",
    clicks: ['[data-testid="agents-tab-editor"]'],
    selectors: ['[data-testid="agents-content-layout"]', '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "agents memory",
    route: "agents",
    clicks: ['[data-testid="agents-tab-memory"]'],
    selectors: ['[data-testid="agents-content-layout"]', '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "agents runs",
    route: "agents",
    clicks: ['[data-testid="agents-tab-runs"]'],
    selectors: ['[data-testid="agents-content-layout"]', '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "configure general",
    route: "configure",
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "configure policy",
    route: "configure",
    clicks: ['[data-testid="admin-http-tab-policy"]'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "configure providers",
    route: "configure",
    clicks: ['[data-testid="admin-http-tab-providers"]'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "configure models",
    route: "configure",
    clicks: ['[data-testid="admin-http-tab-models"]'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "configure audit",
    route: "configure",
    clicks: ['[data-testid="admin-http-tab-audit"]'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "configure channels",
    route: "configure",
    clicks: ['[data-testid="admin-http-tab-routing-config"]'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "configure secrets",
    route: "configure",
    clicks: ['[data-testid="admin-http-tab-secrets"]'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "configure plugins",
    route: "configure",
    clicks: ['[data-testid="admin-http-tab-plugins"]'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "configure tokens",
    route: "configure",
    clicks: ['[data-testid="admin-http-tab-gateway"]'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "configure commands",
    route: "configure",
    clicks: ['[data-testid="admin-ws-tab-commands"]'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "browser capabilities",
    route: "browser",
    selectors: ["[data-layout-content]"],
  },
  {
    name: "node configure general",
    route: "node-configure",
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "node configure desktop",
    route: "node-configure",
    clicks: ['[role="tab"]:has-text("Desktop")'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "node configure browser",
    route: "node-configure",
    clicks: ['[role="tab"]:has-text("Browser")'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "node configure shell",
    route: "node-configure",
    clicks: ['[role="tab"]:has-text("Shell")'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
  {
    name: "node configure web",
    route: "node-configure",
    clicks: ['[role="tab"]:has-text("Web")'],
    selectors: ["[data-layout-content]", '[role="tabpanel"][data-state="active"]'],
  },
];

async function assertNoHorizontalOverflow(page: Page, selectors: string[]): Promise<void> {
  const result = await page.evaluate((candidateSelectors) => {
    const viewportWidth = window.innerWidth;
    const documentOverflow = Math.max(0, document.documentElement.scrollWidth - viewportWidth);
    const measurements = candidateSelectors.map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) {
        return { selector, found: false, right: null, overflow: null };
      }
      const rect = element.getBoundingClientRect();
      return {
        selector,
        found: true,
        right: rect.right,
        overflow: Math.max(0, rect.right - viewportWidth),
      };
    });

    return {
      viewportWidth,
      documentOverflow,
      measurements,
    };
  }, selectors);

  expect(result.documentOverflow).toBeLessThanOrEqual(1);

  for (const measurement of result.measurements) {
    expect(measurement.found, `${measurement.selector} should exist`).toBe(true);
    expect(
      measurement.overflow,
      `${measurement.selector} overflowed by ${measurement.overflow}px`,
    ).toBeLessThanOrEqual(1);
  }
}

describe("layout regression harness", () => {
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
  });

  for (const testCase of cases) {
    it(`keeps ${testCase.name} within the desktop viewport`, { timeout: 30_000 }, async () => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      try {
        await page.goto(`${baseUrl}?route=${testCase.route}`, { waitUntil: "load" });
        await page.waitForSelector(testCase.selectors[0]);

        for (const selector of testCase.clicks ?? []) {
          await page.click(selector);
          await page.waitForTimeout(50);
        }

        await assertNoHorizontalOverflow(page, testCase.selectors);
      } finally {
        await page.close();
      }
    });
  }
});
