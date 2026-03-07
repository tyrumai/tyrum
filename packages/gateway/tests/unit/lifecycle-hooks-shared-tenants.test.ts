import { afterEach, describe, expect, it, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import { DEFAULT_TENANT_ID } from "../../src/modules/identity/scope.js";
import { fireGatewayStartHook } from "../../src/bootstrap/runtime-builders.js";
import { fireGatewayLifecycleHooks } from "../../src/bootstrap/runtime-builders-shutdown.js";

function createLogger() {
  return {
    child: () => createLogger(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createContext() {
  const logger = createLogger();
  const db = {
    all: vi.fn(async () => [{ tenant_id: DEFAULT_TENANT_ID }, { tenant_id: "tenant-b" }]),
    close: vi.fn(async () => undefined),
  };

  return {
    context: {
      shouldRunEdge: true,
      shouldRunWorker: true,
      instanceId: "instance-1",
      role: "all",
      deploymentConfig: { state: { mode: "shared" } },
      container: {
        db,
        watcherProcessor: { stop: vi.fn() },
        modelsDev: { stopBackgroundRefresh: vi.fn() },
      },
      logger,
    },
    db,
    logger,
  };
}

describe("shared lifecycle hooks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires gateway.start hooks for every tenant in shared mode", async () => {
    const { context } = createContext();
    const fire = vi.fn(async () => [] as string[]);

    fireGatewayStartHook(
      context as never,
      {
        hooksRuntime: { fire },
      } as never,
    );

    await setImmediate();
    expect(fire).toHaveBeenCalledTimes(2);
    expect(fire).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ event: "gateway.start", tenantId: DEFAULT_TENANT_ID }),
    );
    expect(fire).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ event: "gateway.start", tenantId: "tenant-b" }),
    );
  });

  it("fires gateway.shutdown hooks for every tenant in shared mode", async () => {
    const { context } = createContext();
    const fire = vi.fn(async () => [] as string[]);
    await fireGatewayLifecycleHooks(context as never, { fire }, { event: "gateway.shutdown" });

    expect(fire).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ event: "gateway.shutdown", tenantId: DEFAULT_TENANT_ID }),
    );
    expect(fire).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ event: "gateway.shutdown", tenantId: "tenant-b" }),
    );
  });
});
