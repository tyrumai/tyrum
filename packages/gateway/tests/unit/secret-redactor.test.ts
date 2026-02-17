import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../src/modules/secret/redactor.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { SecretHandle as SecretHandleT } from "@tyrum/schemas";

function makeHandle(scope: string): SecretHandleT {
  return {
    handle_id: `handle-${scope}`,
    provider: "env",
    scope,
    created_at: new Date().toISOString(),
  };
}

function makeProvider(secrets: Record<string, string>): SecretProvider {
  return {
    async resolve(handle: SecretHandleT) {
      return secrets[handle.scope] ?? null;
    },
    async store() {
      throw new Error("not implemented");
    },
    async revoke() {
      return false;
    },
    async list() {
      return [];
    },
  };
}

describe("redactSecrets", () => {
  it("redacts known secret values in text", async () => {
    const provider = makeProvider({ API_KEY: "sk-12345" });
    const handle = makeHandle("API_KEY");

    const result = await redactSecrets(
      "Authorization: Bearer sk-12345",
      [handle],
      provider,
    );
    expect(result).toBe("Authorization: Bearer [REDACTED]");
  });

  it("handles multiple secrets", async () => {
    const provider = makeProvider({ KEY_A: "alpha", KEY_B: "beta" });
    const handles = [makeHandle("KEY_A"), makeHandle("KEY_B")];

    const result = await redactSecrets(
      "first=alpha second=beta",
      handles,
      provider,
    );
    expect(result).toBe("first=[REDACTED] second=[REDACTED]");
  });

  it("redacts all occurrences of a secret", async () => {
    const provider = makeProvider({ TOKEN: "abc" });
    const handle = makeHandle("TOKEN");

    const result = await redactSecrets("abc and abc again", [handle], provider);
    expect(result).toBe("[REDACTED] and [REDACTED] again");
  });

  it("handles empty handles list", async () => {
    const provider = makeProvider({});
    const result = await redactSecrets("no secrets here", [], provider);
    expect(result).toBe("no secrets here");
  });

  it("handles null resolve gracefully", async () => {
    const provider = makeProvider({});
    const handle = makeHandle("MISSING");

    const result = await redactSecrets("keep this text", [handle], provider);
    expect(result).toBe("keep this text");
  });

  it("does not modify text when no secrets match", async () => {
    const provider = makeProvider({ KEY: "xyz" });
    const handle = makeHandle("KEY");

    const result = await redactSecrets("nothing to redact", [handle], provider);
    expect(result).toBe("nothing to redact");
  });
});
