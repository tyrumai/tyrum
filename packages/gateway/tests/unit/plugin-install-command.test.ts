import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Logger } from "../../src/modules/observability/logger.js";
import { PluginRegistry } from "../../src/modules/plugins/registry.js";
import { runCli } from "../../src/index.js";

function pluginIntegritySha256Hex(manifestRaw: string, entryRaw: string): string {
  return createHash("sha256")
    .update("manifest\0")
    .update(manifestRaw)
    .update("\0entry\0")
    .update(entryRaw)
    .digest("hex");
}

function pluginManifestYaml(opts?: { id?: string }): string {
  const id = opts?.id ?? "echo";
  return [
    `id: ${id}`,
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

describe("tyrum plugin install", () => {
  let home: string | undefined;
  let source: string | undefined;

  afterEach(async () => {
    await Promise.allSettled([
      home ? rm(home, { recursive: true, force: true }) : Promise.resolve(),
      source ? rm(source, { recursive: true, force: true }) : Promise.resolve(),
    ]);
    home = undefined;
    source = undefined;
  });

  it("installs a plugin and records a plugin.lock.json with pinned version and integrity", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-home-"));
    source = await mkdtemp(join(tmpdir(), "tyrum-plugin-src-"));

    await mkdir(join(source, "nested"), { recursive: true });
    await writeFile(join(source, "plugin.yml"), pluginManifestYaml(), "utf-8");
    await writeFile(join(source, "index.mjs"), pluginEntryModule(), "utf-8");

    const exitCode = await runCli(["plugin", "install", source, "--home", home]);
    expect(exitCode).toBe(0);

    const installedDir = join(home, "plugins", "echo");
    const lockRaw = await readFile(join(installedDir, "plugin.lock.json"), "utf-8");
    const lockJson = JSON.parse(lockRaw) as Record<string, unknown>;
    expect(lockJson["format"]).toBe("tyrum.plugin.lock.v1");
    expect(lockJson["pinned_version"]).toBe("0.0.1");

    const manifestRaw = await readFile(join(installedDir, "plugin.yml"), "utf-8");
    const entryRaw = await readFile(join(installedDir, "index.mjs"), "utf-8");
    const expectedIntegrity = pluginIntegritySha256Hex(manifestRaw, entryRaw);
    expect(lockJson["integrity_sha256"]).toBe(expectedIntegrity);

    const registry = await PluginRegistry.load({
      home,
      logger: new Logger({ level: "silent" }),
    });
    const listed = registry.list() as unknown as Array<Record<string, unknown>>;
    expect(listed.map((p) => p["id"])).toEqual(["echo"]);
    expect((listed[0]?.["install"] as Record<string, unknown> | undefined)?.["pinned_version"]).toBe("0.0.1");
    expect((listed[0]?.["install"] as Record<string, unknown> | undefined)?.["integrity_sha256"]).toBe(expectedIntegrity);
  });

  it("rejects plugin installs when the manifest id is not a safe directory segment", async () => {
    home = await mkdtemp(join(tmpdir(), "tyrum-home-"));
    source = await mkdtemp(join(tmpdir(), "tyrum-plugin-src-"));

    await writeFile(join(source, "plugin.yml"), pluginManifestYaml({ id: "../evil" }), "utf-8");
    await writeFile(join(source, "index.mjs"), pluginEntryModule(), "utf-8");

    const exitCode = await runCli(["plugin", "install", source, "--home", home]);
    expect(exitCode).toBe(1);

    await expect(stat(join(home, "evil"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(home, "plugins", "echo"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
