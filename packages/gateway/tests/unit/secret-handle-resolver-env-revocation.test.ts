import { afterEach, describe, expect, it } from "vitest";
import { EnvSecretProvider } from "../../src/modules/secret/provider.js";
import { createSecretHandleResolver } from "../../src/modules/secret/handle-resolver.js";

describe("SecretHandleResolver + EnvSecretProvider", () => {
  afterEach(() => {
    delete process.env["MY_API_KEY"];
  });

  it("does not resolve revoked handles from resolver cache", async () => {
    process.env["MY_API_KEY"] = "v1";

    const provider = new EnvSecretProvider();
    const handle = await provider.store("MY_API_KEY", "ignored");
    const resolver = createSecretHandleResolver(provider);

    const first = await resolver.resolveById(handle.handle_id);
    expect(first).toBe("v1");

    await provider.revoke(handle.handle_id);

    const second = await resolver.resolveById(handle.handle_id);
    expect(second).toBeNull();
  });
});

