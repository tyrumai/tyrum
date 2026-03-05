import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

describe("createContainer oauthProviderRegistry", () => {
  let container: GatewayContainer | undefined;
  let homeDir: string | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }

    delete process.env["TYRUM_HOME"];
    delete process.env["TYRUM_OAUTH_PROVIDERS_CONFIG"];
  });

  it("loads oauth providers from configured tyrumHome when TYRUM_HOME is unset", async () => {
    delete process.env["TYRUM_HOME"];
    delete process.env["TYRUM_OAUTH_PROVIDERS_CONFIG"];

    homeDir = await mkdtemp(join(tmpdir(), "tyrum-home-"));

    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    await container.db.run(
      `INSERT INTO oauth_provider_configs (tenant_id, provider_id, client_id)
       VALUES (?, ?, ?)`,
      [DEFAULT_TENANT_ID, "test", "client-test"],
    );

    const spec = await container.oauthProviderRegistry.get({
      tenantId: DEFAULT_TENANT_ID,
      providerId: "test",
    });
    expect(spec?.provider_id).toBe("test");
  });
});
