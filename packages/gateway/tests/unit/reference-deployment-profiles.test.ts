import { describe, expect, it } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../../..");

async function expectFile(path: string): Promise<string> {
  const fullPath = resolve(repoRoot, path);
  const info = await stat(fullPath);
  expect(info.isFile()).toBe(true);
  return await readFile(fullPath, "utf-8");
}

function parseEnvFile(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    entries.set(key, value);
  }
  return entries;
}

describe("reference deployment profiles", () => {
  it("ships reproducible single-host and split-role env templates", async () => {
    const singleHostEnv = parseEnvFile(
      await expectFile("config/deployments/single-host.env.example"),
    );
    const splitRoleEnv = parseEnvFile(
      await expectFile("config/deployments/split-role.env.example"),
    );

    const singleHostToken = singleHostEnv.get("GATEWAY_TOKEN");
    expect(singleHostToken).toBeDefined();
    expect(singleHostToken).toBe("");
    expect(singleHostEnv.get("TYRUM_HOME")).toBeUndefined();
    expect(singleHostEnv.get("GATEWAY_DB_PATH")).toBeUndefined();

    const splitRoleToken = splitRoleEnv.get("GATEWAY_TOKEN");
    expect(splitRoleToken).toBeDefined();
    expect(splitRoleToken).toBe("");
    expect(splitRoleEnv.get("GATEWAY_DB_PATH")).toBeUndefined();
  });

  it("keeps reference compose deployments exposing db paths for smoke helpers", async () => {
    const composeRaw = await expectFile("docker-compose.yml");
    const compose = parseYaml(composeRaw) as any;
    const services = compose.services as Record<string, any> | undefined;

    const singleHost = services?.tyrum;
    expect(singleHost).toBeDefined();

    const singleHostCommand = singleHost?.command as string[] | undefined;
    expect(singleHostCommand).toBeDefined();

    const singleHostDbFlagIndex = singleHostCommand?.indexOf("--db") ?? -1;
    expect(singleHostDbFlagIndex).toBeGreaterThanOrEqual(0);
    const singleHostDbPath = singleHostCommand?.[singleHostDbFlagIndex + 1];
    expect(singleHostDbPath).toBe("/var/lib/tyrum/gateway.db");

    const singleHostEnv = singleHost?.environment as Record<string, unknown> | undefined;
    expect(singleHostEnv?.GATEWAY_DB_PATH).toBe(singleHostDbPath);
    expect(singleHostEnv?.GATEWAY_TOKEN).toBe("${GATEWAY_TOKEN:-}");

    const splitServices = ["tyrum-edge", "tyrum-worker", "tyrum-scheduler"];
    for (const serviceName of splitServices) {
      const service = services?.[serviceName];
      expect(service).toBeDefined();

      const command = service.command as string[] | undefined;
      expect(command).toBeDefined();

      const homeFlagIndex = command?.indexOf("--home") ?? -1;
      expect(homeFlagIndex).toBeGreaterThanOrEqual(0);
      expect(command?.[homeFlagIndex + 1]).toBe("/var/lib/tyrum");

      const dbFlagIndex = command?.indexOf("--db") ?? -1;
      expect(dbFlagIndex).toBeGreaterThanOrEqual(0);
      const dbPath = command?.[dbFlagIndex + 1];
      expect(dbPath).toEqual(expect.stringMatching(/postgres(ql)?:\/\//u));

      const env = service.environment as Record<string, unknown> | undefined;
      expect(env?.GATEWAY_DB_PATH).toBe(dbPath);
      expect(env?.GATEWAY_TOKEN).toBe("${GATEWAY_TOKEN:-}");
    }

    const desktopSandbox = services?.["desktop-sandbox"];
    const desktopSandboxEnv = desktopSandbox?.environment as Record<string, unknown> | undefined;
    expect(desktopSandboxEnv?.TYRUM_GATEWAY_TOKEN).toBe("${GATEWAY_TOKEN:-}");
    expect(desktopSandboxEnv?.TYRUM_GATEWAY_TOKEN_PATH).toBeUndefined();
    expect(desktopSandbox?.volumes).not.toContain("tyrum-data:/gateway:ro");
  });

  it("keeps snapshot import disabled by default in reference compose deployments", async () => {
    const composeRaw = await expectFile("docker-compose.yml");
    const compose = parseYaml(composeRaw) as any;
    const services = compose.services as Record<string, any> | undefined;

    const singleHost = services?.tyrum;
    const singleHostCommand = singleHost?.command as string[] | undefined;
    const singleHostEnv = singleHost?.environment as Record<string, unknown> | undefined;

    expect(singleHostCommand).toBeDefined();
    expect(singleHostCommand).not.toContain("--enable-snapshot-import");
    expect(singleHostEnv?.TYRUM_SNAPSHOT_IMPORT_ENABLED).toBe(
      "${TYRUM_SNAPSHOT_IMPORT_ENABLED:-0}",
    );

    const splitServices = ["tyrum-edge", "tyrum-worker", "tyrum-scheduler"];
    for (const serviceName of splitServices) {
      const service = services?.[serviceName];
      const command = service?.command as string[] | undefined;
      const env = service?.environment as Record<string, unknown> | undefined;

      expect(command).toBeDefined();
      expect(command).not.toContain("--enable-snapshot-import");
      expect(env?.TYRUM_SNAPSHOT_IMPORT_ENABLED).toBe("${TYRUM_SNAPSHOT_IMPORT_ENABLED:-0}");
    }
  });

  it("ships reference Helm values for single-host and split-role", async () => {
    const singleValuesRaw = await expectFile("config/deployments/helm-single.values.yaml");
    const splitValuesRaw = await expectFile("config/deployments/helm-split-role.values.yaml");

    const singleValues = parseYaml(singleValuesRaw) as any;
    const splitValues = parseYaml(splitValuesRaw) as any;

    expect(singleValues.mode).toBe("single");
    expect(splitValues.mode).toBe("split");

    expect(singleValues.runtime?.home).toBe("/var/lib/tyrum");
    expect(singleValues.runtime?.host).toBe("0.0.0.0");
    expect(singleValues.runtime?.tlsReady).toBe(true);
    expect(singleValues.runtime?.enableEngineApi).toBe(true);
    expect(singleValues.env?.GATEWAY_HOST).toBeUndefined();

    expect(splitValues.runtime?.db).toMatch(/^postgres(ql)?:\/\//u);
    expect(splitValues.runtime?.db).toContain("REPLACE_ME");
  });

  it("documents how to use the profiles", async () => {
    const doc = await expectFile("docs/advanced/deployment-profiles.md");
    expect(doc).toContain("single-host");
    expect(doc).toContain("split-role");
    expect(doc).toContain("docker compose");
    expect(doc).toContain("Helm");
  });
});
