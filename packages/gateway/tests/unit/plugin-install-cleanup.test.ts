import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { writeFileMock, actualWriteFile } = vi.hoisted(() => ({
  writeFileMock: vi.fn(),
  actualWriteFile: { fn: undefined as typeof import("node:fs/promises").writeFile | undefined },
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  actualWriteFile.fn = actual.writeFile;
  return {
    ...actual,
    writeFile: (...args: Parameters<typeof actual.writeFile>) => writeFileMock(...args),
  };
});

import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { runCli } from "../../src/index.js";

function pluginManifestYaml(): string {
  return [
    "id: echo",
    "name: Echo",
    "version: 0.0.1",
    "entry: ./index.mjs",
    "contributes:",
    "  tools: []",
    "  commands: []",
    "  routes: []",
    "  mcp_servers: []",
    "permissions:",
    "  tools: []",
    "  network_egress: []",
    "  secrets: []",
    "  db: false",
    "config_schema:",
    "  type: object",
    "  properties: {}",
    "  required: []",
    "  additionalProperties: false",
    "",
  ].join("\n");
}

function pluginEntryModule(): string {
  return `
export function registerPlugin() {
  return {};
}
`;
}

describe("tyrum plugin install cleanup", () => {
  let home: string | undefined;
  let source: string | undefined;

  afterEach(async () => {
    writeFileMock.mockReset();
    await Promise.allSettled([
      home ? rm(home, { recursive: true, force: true }) : Promise.resolve(),
      source ? rm(source, { recursive: true, force: true }) : Promise.resolve(),
    ]);
    home = undefined;
    source = undefined;
  });

  it("removes the destination plugin dir when writing plugin.lock.json fails", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-home-"));
    source = await mkdtemp(join(tmpdir(), "tyrum-plugin-src-"));
    await mkdir(source, { recursive: true });

    if (!actualWriteFile.fn) {
      throw new Error("actual writeFile not captured");
    }

    await actualWriteFile.fn(join(source, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await actualWriteFile.fn(join(source, "index.mjs"), pluginEntryModule(), "utf-8");

    writeFileMock.mockImplementation(async (path, data, options) => {
      if (String(path).endsWith("plugin.lock.json")) {
        throw new Error("simulated lockfile write failure");
      }
      return await actualWriteFile.fn!(path as never, data as never, options as never);
    });

    const exitCode = await runCli(["plugin", "install", source, "--home", home]);
    expect(exitCode).toBe(1);

    await expect(stat(join(home, "plugins", "echo"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
