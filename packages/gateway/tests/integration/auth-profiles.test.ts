import { describe, expect, it, vi } from "vitest";
import { createContainer } from "../../src/container.js";
import { createApp } from "../../src/app.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { SecretHandle } from "@tyrum/schemas";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

function stubSecretProvider(): SecretProvider {
  const values = new Map<string, string>();
  let nextId = 0;
  return {
    resolve: vi.fn(async (handle: SecretHandle) => values.get(handle.handle_id) ?? null),
    store: vi.fn(async (scope: string, value: string) => {
      const handle: SecretHandle = {
        handle_id: `h-${String(++nextId)}`,
        provider: "file",
        scope,
        created_at: new Date().toISOString(),
      };
      values.set(handle.handle_id, value);
      return handle;
    }),
    revoke: vi.fn(async (handleId: string) => values.delete(handleId)),
    list: vi.fn(async () => []),
  };
}

describe("auth profile routes", () => {
  it("creates, lists, and deletes api_key profiles", async () => {
    const container = await createContainer({ dbPath: ":memory:", migrationsDir });
    const secretProvider = stubSecretProvider();
    const app = createApp(container, { secretProvider });

    const createRes = await app.request("/auth/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: "default",
        provider: "openai",
        type: "api_key",
        scope: "OPENAI_KEY",
        value: "sk-test",
      }),
    });
    expect(createRes.status).toBe(201);

    const listRes = await app.request("/auth/profiles?provider=openai");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { profiles: Array<{ profile_id: string }> };
    expect(listBody.profiles.length).toBe(1);

    const profileId = listBody.profiles[0]!.profile_id;
    const deleteRes = await app.request(`/auth/profiles/${profileId}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(200);
  });
});

