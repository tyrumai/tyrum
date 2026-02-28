import { afterEach, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createContainer, type GatewayContainer } from "../../src/container.js";
import { loadConfig } from "../../src/config.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "../../migrations/sqlite");

const telegramQueueCtor = vi.fn();

vi.mock("../../src/modules/channels/telegram.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/modules/channels/telegram.js")>();

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
    delete process.env["TYRUM_CHANNEL_PIPELINE_ENABLED"];
  });

  it("uses config.channels.pipelineEnabled when deciding to construct TelegramChannelQueue", async () => {
    process.env["TYRUM_CHANNEL_PIPELINE_ENABLED"] = "1";

    const gatewayConfig = loadConfig({
      GATEWAY_TOKEN: "test-token",
      TYRUM_CHANNEL_PIPELINE_ENABLED: "0",
    });
    container = createContainer({ dbPath: ":memory:", migrationsDir }, { gatewayConfig });
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

