import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OAuthProviderRegistry } from "../../src/modules/oauth/provider-registry.js";

describe("OAuthProviderRegistry config defaults", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
    delete process.env["TYRUM_OAUTH_PROVIDERS_CONFIG"];
  });

  it("defaults token_endpoint_basic_auth to false for public clients", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-oauth-registry-test-"));
    const configPath = join(tempDir, "oauth-providers.yml");
    await writeFile(
      configPath,
      [
        "providers:",
        "  - provider_id: public",
        "    scopes: []",
        "    client_id_env: TEST_CLIENT_ID",
      ].join("\n"),
      "utf-8",
    );

    const registry = new OAuthProviderRegistry({ configPath });
    const spec = await registry.get("public");
    expect(spec?.token_endpoint_basic_auth).toBe(false);
  });

  it("defaults token_endpoint_basic_auth to false even when client_secret_env is configured", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-oauth-registry-test-"));
    const configPath = join(tempDir, "oauth-providers.yml");
    await writeFile(
      configPath,
      [
        "providers:",
        "  - provider_id: confidential",
        "    scopes: []",
        "    client_id_env: TEST_CLIENT_ID",
        "    client_secret_env: TEST_CLIENT_SECRET",
      ].join("\n"),
      "utf-8",
    );

    const registry = new OAuthProviderRegistry({ configPath });
    const spec = await registry.get("confidential");
    expect(spec?.token_endpoint_basic_auth).toBe(false);
  });

  it("fails fast when token_endpoint_basic_auth=true but client_secret_env is missing", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tyrum-oauth-registry-test-"));
    const configPath = join(tempDir, "oauth-providers.yml");
    await writeFile(
      configPath,
      [
        "providers:",
        "  - provider_id: broken",
        "    scopes: []",
        "    client_id_env: TEST_CLIENT_ID",
        "    token_endpoint_basic_auth: true",
      ].join("\n"),
      "utf-8",
    );

    const registry = new OAuthProviderRegistry({ configPath });
    await expect(registry.list()).rejects.toThrow("client_secret_env");
  });
});
