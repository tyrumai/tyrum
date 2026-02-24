import { afterEach, describe, expect, it } from "vitest";
import { EnvSecretProvider } from "../../src/modules/secret/provider.js";
import { createSecretHandleResolver } from "../../src/modules/secret/handle-resolver.js";

describe("SecretHandleResolver + EnvSecretProvider", () => {
  let hadPrevious = false;
  let previousValue: string | undefined;

  afterEach(() => {
    if (hadPrevious) {
      process.env["MY_API_KEY"] = previousValue;
    } else {
      delete process.env["MY_API_KEY"];
    }
    hadPrevious = false;
    previousValue = undefined;
  });

  it("does not resolve revoked handles from resolver cache", async () => {
    hadPrevious = Object.prototype.hasOwnProperty.call(process.env, "MY_API_KEY");
    previousValue = process.env["MY_API_KEY"];
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
