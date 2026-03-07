import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeploymentConfig } from "@tyrum/schemas";
import { createContainer } from "../../src/container.js";
import { createProtocolRuntime } from "../../src/bootstrap/runtime-builders.js";
import type { GatewayBootContext } from "../../src/bootstrap/runtime-shared.js";
import { SQLITE_MIGRATIONS_DIR } from "../helpers/sqlite-db.js";

describe("createProtocolRuntime hooks gating", () => {
  let homeDir: string | undefined;

  afterEach(async () => {
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
      homeDir = undefined;
    }
  });

  it("does not create a hooks runtime in local mode when no hooks are configured", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-hooks-runtime-"));
    const container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir: SQLITE_MIGRATIONS_DIR,
        tyrumHome: homeDir,
      },
      {
        deploymentConfig: DeploymentConfig.parse({ state: { mode: "local" } }),
      },
    );

    const logger = container.logger.child({ test: "runtime-builders-hooks" });
    const context: GatewayBootContext = {
      instanceId: "test-instance",
      role: "edge",
      tyrumHome: homeDir,
      host: "127.0.0.1",
      port: 8788,
      dbPath: ":memory:",
      migrationsDir: SQLITE_MIGRATIONS_DIR,
      isLocalOnly: true,
      shouldRunEdge: true,
      shouldRunWorker: false,
      deploymentConfig: container.deploymentConfig,
      container,
      logger,
      authTokens: {} as GatewayBootContext["authTokens"],
      secretProviderForTenant: (() => ({
        list: async () => [],
        resolve: async () => null,
        store: async () => {
          throw new Error("not implemented");
        },
        revoke: async () => false,
      })) as GatewayBootContext["secretProviderForTenant"],
      lifecycleHooks: [],
    };

    try {
      const protocol = await createProtocolRuntime(context, {
        enabled: false,
        shutdown: async () => undefined,
      });

      expect(protocol.hooksRuntime).toBeUndefined();
      protocol.approvalEngineActionProcessor?.stop();
    } finally {
      await container.db.close();
    }
  });

  it("uses the shared config store for hooks in shared mode", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "tyrum-hooks-runtime-shared-"));
    const container = createContainer(
      {
        dbPath: ":memory:",
        migrationsDir: SQLITE_MIGRATIONS_DIR,
        tyrumHome: homeDir,
      },
      {
        deploymentConfig: DeploymentConfig.parse({ state: { mode: "shared" } }),
      },
    );

    const logger = container.logger.child({ test: "runtime-builders-hooks-shared" });
    const context: GatewayBootContext = {
      instanceId: "test-instance",
      role: "edge",
      tyrumHome: homeDir,
      host: "127.0.0.1",
      port: 8788,
      dbPath: ":memory:",
      migrationsDir: SQLITE_MIGRATIONS_DIR,
      isLocalOnly: false,
      shouldRunEdge: true,
      shouldRunWorker: false,
      deploymentConfig: container.deploymentConfig,
      container,
      logger,
      authTokens: {} as GatewayBootContext["authTokens"],
      secretProviderForTenant: (() => ({
        list: async () => [],
        resolve: async () => null,
        store: async () => {
          throw new Error("not implemented");
        },
        revoke: async () => false,
      })) as GatewayBootContext["secretProviderForTenant"],
      lifecycleHooks: [],
    };

    try {
      const protocol = await createProtocolRuntime(context, {
        enabled: false,
        shutdown: async () => undefined,
      });

      expect(protocol.hooksRuntime).toBeDefined();
      expect((protocol.hooksRuntime as never).opts.hooks).toBeUndefined();
      protocol.approvalEngineActionProcessor?.stop();
    } finally {
      await container.db.close();
    }
  });
});
