import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { DeploymentConfig } from "@tyrum/schemas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const telegramQueueCtor = vi.fn();
const telegramRuntimeCtor = vi.fn();

vi.mock("../../src/modules/channels/telegram.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/modules/channels/telegram.js")>();
  function TelegramChannelQueue(...args: unknown[]) {
    telegramQueueCtor(...args);
  }

  return {
    ...original,
    TelegramChannelQueue,
  };
});

vi.mock("../../src/modules/channels/telegram-runtime.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/modules/channels/telegram-runtime.js")>();

  function TelegramChannelRuntime(...args: unknown[]) {
    telegramRuntimeCtor(...args);
  }

  return {
    ...original,
    TelegramChannelRuntime,
  };
});

describe("createApp channel pipeline wiring", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    telegramQueueCtor.mockClear();
    telegramRuntimeCtor.mockClear();
  });

  it("constructs TelegramChannelQueue even when the legacy deployment pipeline flag is false", async () => {
    container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({ channels: { pipelineEnabled: false } }) },
    );

    const agents = {
      getRuntime: async () => {
        throw new Error("not implemented");
      },
    } as unknown as AgentRegistry;

    const { createApp } = await import("../../src/app.js");
    createApp(container, { agents });

    expect(telegramQueueCtor).toHaveBeenCalledOnce();
  });

  it("reuses an injected TelegramChannelRuntime instead of constructing another one", async () => {
    container = createContainer({ dbPath: ":memory:", migrationsDir });

    const agents = {
      getRuntime: async () => {
        throw new Error("not implemented");
      },
    } as unknown as AgentRegistry;

    const { createApp } = await import("../../src/app.js");
    createApp(container, { agents, telegramRuntime: {} as any });

    expect(telegramQueueCtor).toHaveBeenCalledOnce();
    expect(telegramRuntimeCtor).not.toHaveBeenCalled();
  });
});
