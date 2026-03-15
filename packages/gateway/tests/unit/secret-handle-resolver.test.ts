import { describe, expect, it, vi } from "vitest";
import {
  createSecretHandleResolver,
  resolveSecretsWithHandles,
} from "../../src/modules/secret/handle-resolver.js";

describe("createSecretHandleResolver", () => {
  it("caches handles by id for lookup and value resolution", async () => {
    const handle = {
      handle_id: "secret-1",
      provider: "vault",
      scope: "payments",
      kind: "opaque",
      created_at: "2026-01-01T00:00:00.000Z",
      fingerprint: null,
      summary: null,
      label: null,
      version: null,
    } as const;
    const secretProvider = {
      list: vi.fn(async () => [handle]),
      resolve: vi.fn(async () => "resolved-value"),
    };

    const resolver = createSecretHandleResolver(secretProvider);

    await expect(resolver.getById(" secret-1 ")).resolves.toEqual(handle);
    await expect(resolver.resolveById("secret-1")).resolves.toBe("resolved-value");

    expect(secretProvider.list).toHaveBeenCalledTimes(1);
    expect(secretProvider.resolve).toHaveBeenCalledWith(handle);
  });

  it("refreshes the cached handle set", async () => {
    const firstHandle = {
      handle_id: "secret-1",
      provider: "vault",
      scope: "initial",
      kind: "opaque",
      created_at: "2026-01-01T00:00:00.000Z",
      fingerprint: null,
      summary: null,
      label: null,
      version: null,
    } as const;
    const secondHandle = {
      ...firstHandle,
      scope: "updated",
    } as const;
    const secretProvider = {
      list: vi
        .fn<() => Promise<readonly typeof firstHandle[]>>()
        .mockResolvedValueOnce([firstHandle])
        .mockResolvedValueOnce([secondHandle]),
      resolve: vi.fn(async () => "value"),
    };

    const resolver = createSecretHandleResolver(secretProvider);

    await expect(resolver.getById("secret-1")).resolves.toEqual(firstHandle);
    await resolver.refresh();
    await expect(resolver.getById("secret-1")).resolves.toEqual(secondHandle);

    expect(secretProvider.list).toHaveBeenCalledTimes(2);
  });

  it("resolves scopes and falls back to raw handle ids when a handle is missing", async () => {
    const handle = {
      handle_id: "secret-1",
      provider: "vault",
      scope: "payments",
      kind: "opaque",
      created_at: "2026-01-01T00:00:00.000Z",
      fingerprint: null,
      summary: null,
      label: null,
      version: null,
    } as const;
    const secretProvider = {
      list: vi.fn(async () => [handle]),
      resolve: vi.fn(async () => "resolved-value"),
    };

    const resolver = createSecretHandleResolver(secretProvider);

    await expect(resolver.getById("missing")).resolves.toBeNull();
    await expect(resolver.resolveScopes(["secret-1", "missing", "  "])).resolves.toEqual([
      "vault:payments",
      "missing",
    ]);
  });

  it("replaces nested secret handles with resolved values", async () => {
    const handle = {
      handle_id: "secret-1",
      provider: "vault",
      scope: "payments",
      kind: "opaque",
      created_at: "2026-01-01T00:00:00.000Z",
      fingerprint: null,
      summary: null,
      label: null,
      version: null,
    } as const;
    const secretProvider = {
      list: vi.fn(async () => [handle]),
      resolve: vi.fn(async () => "resolved-value"),
    };

    const resolver = createSecretHandleResolver(secretProvider);

    await expect(
      resolveSecretsWithHandles(
        {
          direct: "secret:secret-1",
          nested: ["keep", { value: "secret:missing" }],
        },
        resolver,
      ),
    ).resolves.toEqual({
      resolved: {
        direct: "resolved-value",
        nested: ["keep", { value: "secret:missing" }],
      },
      secrets: ["resolved-value"],
    });
  });
});
