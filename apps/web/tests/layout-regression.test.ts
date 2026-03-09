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
  viewport?: {
    width: number;
    height: number;
  };
};

const cases: LayoutCase[] = [
  {
    name: "activity",
    route: "activity",
    selectors: ["[data-testid='activity-page']"],
  },
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
    viewport: { width: 1440, height: 900 },
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
      const page = await browser.newPage({
        viewport: testCase.viewport ?? { width: 1280, height: 820 },
      });
      try {
        await page.goto(`${baseUrl}?route=${testCase.route}`, { waitUntil: "load" });
        await page.waitForSelector(testCase.selectors[0]);

        for (const selector of testCase.clicks ?? []) {
          await page.click(selector);
          await page.waitForTimeout(50);
        }

        await assertNoHorizontalOverflow(page, testCase.selectors);
        if (testCase.name === "workboard") {
          await assertNoInternalHorizontalClipping(page, ['[data-testid="workboard-board"]']);
        }
      } finally {
        await page.close();
      }
    });
  }

  it("keeps workboard in the stacked layout at medium widths", { timeout: 30_000 }, async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    try {
      await page.goto(`${baseUrl}?route=workboard`, { waitUntil: "load" });
      await page.waitForSelector("[data-layout-content]");
      await page.waitForSelector('[data-testid="workboard-status-selector"]');

      expect(await page.locator('[data-testid="workboard-board"]').count()).toBe(0);
      await assertNoHorizontalOverflow(page, ["[data-layout-content]"]);
    } finally {
      await page.close();
    }
  });

  it("expands workboard when the sidebar collapses", { timeout: 30_000 }, async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    try {
      await page.goto(`${baseUrl}?route=workboard`, { waitUntil: "load" });
      await page.waitForSelector('[data-testid="workboard-status-selector"]');

      await page.click('[data-testid="sidebar-collapse-toggle"]');
      await page.waitForSelector('[data-testid="workboard-board"]');

      await assertNoHorizontalOverflow(page, [
        "[data-layout-content]",
        '[data-testid="workboard-board"]',
      ]);
      await assertNoInternalHorizontalClipping(page, ['[data-testid="workboard-board"]']);
    } finally {
      await page.close();
    }
  });

  it("expands chat when the sidebar collapses", { timeout: 30_000 }, async () => {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    try {
      await page.goto(`${baseUrl}?route=chat`, { waitUntil: "load" });
      await page.waitForSelector('[data-testid="chat-threads-panel"]');

      expect(await page.locator('[data-testid="chat-conversation-panel"]').count()).toBe(0);

      await page.click('[data-testid="sidebar-collapse-toggle"]');
      await page.waitForSelector('[data-testid="chat-conversation-panel"]');

      await assertNoHorizontalOverflow(page, [
        '[data-testid="chat-page"]',
        '[data-testid="chat-panels"]',
        '[data-testid="chat-threads-panel"]',
        '[data-testid="chat-conversation-panel"]',
      ]);
    } finally {
      await page.close();
    }
  });
});
