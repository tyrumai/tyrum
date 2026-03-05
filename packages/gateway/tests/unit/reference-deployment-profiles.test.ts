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

    expect(singleHostEnv.get("TYRUM_HOME")).toBeDefined();
    expect(singleHostEnv.get("GATEWAY_DB_PATH")).toBeDefined();

    const splitRoleToken = splitRoleEnv.get("GATEWAY_TOKEN");
    expect(splitRoleToken).toBeDefined();
    expect(splitRoleToken).toBe("");
    expect(splitRoleEnv.get("GATEWAY_DB_PATH")).toBeUndefined();
  });

  it("keeps split-role reference deployments Postgres-backed", async () => {
    const composeRaw = await expectFile("docker-compose.yml");
    const compose = parseYaml(composeRaw) as any;
    const services = compose.services as Record<string, any> | undefined;

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
      expect(command?.[dbFlagIndex + 1]).toEqual(expect.stringMatching(/postgres(ql)?:\/\//u));

      const env = service.environment as Record<string, unknown> | undefined;
      expect(env?.GATEWAY_DB_PATH).toBeUndefined();
    }
  });

  it("ships reference Helm values for single-host and split-role", async () => {
    const singleValuesRaw = await expectFile("config/deployments/helm-single.values.yaml");
    const splitValuesRaw = await expectFile("config/deployments/helm-split-role.values.yaml");

    const singleValues = parseYaml(singleValuesRaw) as any;
    const splitValues = parseYaml(splitValuesRaw) as any;

    expect(singleValues.mode).toBe("single");
    expect(splitValues.mode).toBe("split");

    expect(splitValues.env?.GATEWAY_DB_PATH).toMatch(/^postgres(ql)?:\/\//u);
    expect(splitValues.env?.GATEWAY_DB_PATH).toContain("REPLACE_ME");
  });

  it("documents how to use the profiles", async () => {
    const doc = await expectFile("docs/advanced/deployment-profiles.md");
    expect(doc).toContain("single-host");
    expect(doc).toContain("split-role");
    expect(doc).toContain("docker compose");
    expect(doc).toContain("Helm");
  });
});
