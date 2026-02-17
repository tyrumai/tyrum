import { describe, it, expect, afterAll } from "vitest";

// Skip all tests if playwright browsers aren't installed
let canRunPlaywright = false;
try {
  const pw = await import("playwright");
  const browser = await pw.chromium.launch({ headless: true });
  await browser.close();
  canRunPlaywright = true;
} catch {
  // Playwright not available
}

describe.skipIf(!canRunPlaywright)("RealPlaywrightBackend", () => {
  let backend: InstanceType<
    typeof import("../src/main/providers/backends/real-playwright-backend.js").RealPlaywrightBackend
  >;

  // Dynamic import to avoid issues if playwright isn't installed
  const getBackend = async () => {
    const mod = await import(
      "../src/main/providers/backends/real-playwright-backend.js"
    );
    return new mod.RealPlaywrightBackend({ headless: true });
  };

  afterAll(async () => {
    if (backend) await backend.close();
  });

  it("can navigate to a page and get title", async () => {
    backend = await getBackend();
    await backend.ensureBrowser();
    const result = await backend.navigate(
      "data:text/html,<title>Test</title><h1>Hello</h1>",
    );
    expect(result.title).toBe("Test");
    expect(result.url).toContain("data:");
  });

  it("can take a snapshot", async () => {
    backend = await getBackend();
    await backend.ensureBrowser();
    await backend.navigate(
      "data:text/html,<title>Snap</title><body>Content</body>",
    );
    const snap = await backend.snapshot();
    expect(snap.title).toBe("Snap");
    expect(snap.html).toContain("Content");
  });

  it("can fill and click elements", async () => {
    backend = await getBackend();
    await backend.ensureBrowser();
    await backend.navigate(
      "data:text/html,<input id='name' /><button id='btn'>Go</button>",
    );
    await backend.fill("#name", "test value");
    await backend.click("#btn");
    // No error = success
  });

  it("throws descriptive error on missing selector", async () => {
    backend = await getBackend();
    await backend.ensureBrowser();
    await backend.navigate("data:text/html,<p>empty</p>");
    await expect(backend.click("#nonexistent")).rejects.toThrow();
  });

  it("recovers from browser close", async () => {
    backend = await getBackend();
    await backend.ensureBrowser();
    await backend.close();
    // Should re-launch on next ensureBrowser
    await backend.ensureBrowser();
    const result = await backend.navigate(
      "data:text/html,<title>Recovered</title>",
    );
    expect(result.title).toBe("Recovered");
  });
});

describe("RealPlaywrightBackend construction", () => {
  it("can be constructed without throwing", async () => {
    const mod = await import(
      "../src/main/providers/backends/real-playwright-backend.js"
    );
    const backend = new mod.RealPlaywrightBackend({ headless: true });
    expect(backend).toBeDefined();
  });
});
