import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("@tyrum/client entrypoints", () => {
  it("keeps browser-only storage helpers off the node entrypoint", async () => {
    const browserEntry = (await import("../src/browser.js")) as Record<string, unknown>;
    const nodeEntry = (await import("../src/node.js")) as Record<string, unknown>;

    expect(typeof browserEntry["createBrowserLocalStorageDeviceIdentityStorage"]).toBe("function");
    expect("createBrowserLocalStorageDeviceIdentityStorage" in nodeEntry).toBe(false);
  });

  it("re-exports the shared SDK version across public entrypoints", async () => {
    const rootEntry = (await import("../src/index.js")) as Record<string, unknown>;
    const browserEntry = (await import("../src/browser.js")) as Record<string, unknown>;
    const nodeEntry = (await import("../src/node.js")) as Record<string, unknown>;

    expect(rootEntry["VERSION"]).toBeTypeOf("string");
    expect(browserEntry["VERSION"]).toBe(rootEntry["VERSION"]);
    expect(nodeEntry["VERSION"]).toBe(rootEntry["VERSION"]);
  });

  it("avoids static entrypoint cycles and browser-facing node transport imports", async () => {
    const [
      indexSource,
      browserSource,
      nodeSource,
      typesSource,
      httpSharedSource,
      wsTransportSource,
    ] = await Promise.all([
      readFile(resolve(__dirname, "../src/index.ts"), "utf8"),
      readFile(resolve(__dirname, "../src/browser.ts"), "utf8"),
      readFile(resolve(__dirname, "../src/node.ts"), "utf8"),
      readFile(resolve(__dirname, "../src/types.ts"), "utf8"),
      readFile(resolve(__dirname, "../src/http/shared.ts"), "utf8"),
      readFile(resolve(__dirname, "../src/ws-client.transport.ts"), "utf8"),
    ]);

    expect(indexSource).not.toContain("SessionTranscript");
    expect(browserSource).not.toContain('export { VERSION } from "./index.js";');
    expect(browserSource).not.toContain("SessionTranscript");
    expect(nodeSource).not.toContain('export { VERSION } from "./index.js";');
    expect(nodeSource).not.toContain("SessionTranscript");
    expect(typesSource).not.toContain("SessionTranscript");
    expect(indexSource).toContain("SessionContextState");
    expect(browserSource).toContain("SessionContextState");
    expect(nodeSource).toContain("SessionContextState");
    expect(typesSource).toContain("SessionContextState");
    expect(httpSharedSource).not.toContain('from "../node/load-pinned-transport.js"');
    expect(wsTransportSource).not.toContain('from "./node/load-pinned-transport.js"');
  });
});
