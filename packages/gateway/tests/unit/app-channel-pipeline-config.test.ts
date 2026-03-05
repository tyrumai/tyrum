import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { DeploymentConfig } from "@tyrum/schemas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const telegramQueueCtor = vi.fn();

vi.mock("../../src/modules/channels/telegram.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/modules/channels/telegram.js")>();

  return {
    ...original,
    TelegramChannelQueue: class TelegramChannelQueue {
      constructor(...args: unknown[]) {
        telegramQueueCtor(...args);
      }
    },
  };
});

describe("createApp channel pipeline wiring", () => {
  let container: GatewayContainer | undefined;

  afterEach(async () => {
    await container?.db.close();
    container = undefined;
    telegramQueueCtor.mockClear();
  });

  it("uses config.channels.pipelineEnabled when deciding to construct TelegramChannelQueue", async () => {
    container = createContainer(
      { dbPath: ":memory:", migrationsDir },
      { deploymentConfig: DeploymentConfig.parse({ channels: { pipelineEnabled: false } }) },
    );
    container.telegramBot = {} as any;

    const agents = {
      getRuntime: async () => {
        throw new Error("not implemented");
      },
    } as unknown as AgentRegistry;

    const { createApp } = await import("../../src/app.js");
    createApp(container, { agents });

    expect(telegramQueueCtor).not.toHaveBeenCalled();
  });
});
