import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { createSecretProviderFromEnvMock } = vi.hoisted(() => ({
  createSecretProviderFromEnvMock: vi.fn(),
}));

vi.mock("../../src/modules/secret/create-secret-provider.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/modules/secret/create-secret-provider.js")
  >("../../src/modules/secret/create-secret-provider.js");

  return {
    ...actual,
    createSecretProviderFromEnv: createSecretProviderFromEnvMock,
  };
});

import type { GatewayContainer } from "../../src/container.js";
import type { SecretProvider } from "../../src/modules/secret/provider.js";
import type { PolicyService } from "../../src/modules/policy/service.js";
import type { ApprovalNotifier } from "../../src/modules/approval/notifier.js";
import type { Logger } from "../../src/modules/observability/logger.js";
import { AgentRegistry } from "../../src/modules/agent/registry.js";

describe("AgentRegistry cache eviction", () => {
  let baseHome: string | undefined;

  afterEach(async () => {
    createSecretProviderFromEnvMock.mockReset();

    if (baseHome) {
      await rm(baseHome, { recursive: true, force: true });
      baseHome = undefined;
    }
  });

  function makeRegistry(): AgentRegistry {
    const noopProvider = {
      resolve: vi.fn(async () => null),
      store: vi.fn(async () => {
        throw new Error("not implemented");
      }),
      revoke: vi.fn(async () => false),
      list: vi.fn(async () => []),
    } satisfies SecretProvider;

    const container = {
      sessionDal: {},
      approvalDal: {},
      policySnapshotDal: {},
      policyOverrideDal: {},
    } as unknown as GatewayContainer;

    const logger = {
      info: vi.fn(),
    } as unknown as Logger;

    return new AgentRegistry({
      container,
      baseHome: baseHome ?? "unused",
      defaultSecretProvider: noopProvider,
      defaultPolicyService: {} as unknown as PolicyService,
      approvalNotifier: {} as unknown as ApprovalNotifier,
      logger,
    });
  }

  it("evicts rejected secret provider initialization promises", async () => {
    baseHome = await mkdtemp(join(tmpdir(), "tyrum-agent-registry-"));

    const provider = {} as unknown as SecretProvider;
    createSecretProviderFromEnvMock
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(provider);

    const registry = makeRegistry();

    await expect(registry.getSecretProvider("agent-1")).rejects.toThrow("transient");
    await expect(registry.getSecretProvider("agent-1")).resolves.toBe(provider);

    expect(createSecretProviderFromEnvMock).toHaveBeenCalledTimes(2);
  });

  it("evicts rejected runtime initialization promises", async () => {
    baseHome = await mkdtemp(join(tmpdir(), "tyrum-agent-registry-"));

    const provider = {} as unknown as SecretProvider;
    createSecretProviderFromEnvMock
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(provider);

    const registry = makeRegistry();

    await expect(registry.getRuntime("agent-1")).rejects.toThrow("transient");
    const runtime = await registry.getRuntime("agent-1");
    expect(runtime).toBeDefined();
    expect(typeof (runtime as { turn?: unknown }).turn).toBe("function");

    expect(createSecretProviderFromEnvMock).toHaveBeenCalledTimes(2);
  });
});
