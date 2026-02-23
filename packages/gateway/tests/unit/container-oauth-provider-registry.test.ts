import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";

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
    await writeFile(
      join(homeDir, "oauth-providers.yml"),
      [
        "providers:",
        "  - provider_id: test",
        "    scopes: []",
        "    token_endpoint_basic_auth: false",
      ].join("\n"),
      "utf-8",
    );

    container = createContainer({
      dbPath: ":memory:",
      migrationsDir,
      tyrumHome: homeDir,
    });

    const spec = await container.oauthProviderRegistry.get("test");
    expect(spec?.provider_id).toBe("test");
  });
});
