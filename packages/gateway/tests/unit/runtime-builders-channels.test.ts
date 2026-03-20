import { beforeEach, describe, expect, it, vi } from "vitest";

const channelConfigDal = vi.fn();
const googleChatChannelRuntime = vi.fn();
const telegramChannelRuntime = vi.fn();
const routingConfigDal = vi.fn();
const telegramPollingStateDal = vi.fn();
const telegramChannelQueue = vi.fn();
const telegramChannelProcessor = vi.fn();
const telegramPollingMonitor = vi.fn();
const discordChannelMonitor = vi.fn();

const telegramProcessorStart = vi.fn();
const telegramPollingMonitorStart = vi.fn();
const discordChannelMonitorStart = vi.fn();

const telegramRuntimeListEgressConnectors = vi.fn(async () => ["connector"]);
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("../../src/modules/channels/channel-config-dal.js", () => ({
  ChannelConfigDal: vi.fn(function ChannelConfigDalMock() {
    channelConfigDal();
    return {};
  }),
}));

vi.mock("../../src/modules/channels/googlechat-runtime.js", () => ({
  GoogleChatChannelRuntime: vi.fn(function GoogleChatChannelRuntimeMock() {
    googleChatChannelRuntime();
    return {};
  }),
}));

vi.mock("../../src/modules/channels/telegram.js", () => ({
  TelegramChannelProcessor: vi.fn(function TelegramChannelProcessorMock() {
    telegramChannelProcessor();
    return {
      start: telegramProcessorStart,
    };
  }),
  TelegramChannelQueue: vi.fn(function TelegramChannelQueueMock() {
    telegramChannelQueue();
    return {};
  }),
  TelegramPollingMonitor: vi.fn(function TelegramPollingMonitorMock() {
    telegramPollingMonitor();
    return {
      start: telegramPollingMonitorStart,
    };
  }),
}));

vi.mock("../../src/modules/channels/telegram-polling-state-dal.js", () => ({
  TelegramPollingStateDal: vi.fn(function TelegramPollingStateDalMock() {
    telegramPollingStateDal();
    return {};
  }),
}));

vi.mock("../../src/modules/channels/telegram-runtime.js", () => ({
  TelegramChannelRuntime: vi.fn(function TelegramChannelRuntimeMock() {
    telegramChannelRuntime();
    return {
      listEgressConnectors: telegramRuntimeListEgressConnectors,
    };
  }),
}));

vi.mock("../../src/modules/channels/routing-config-dal.js", () => ({
  RoutingConfigDal: vi.fn(function RoutingConfigDalMock() {
    routingConfigDal();
    return {};
  }),
}));

vi.mock("../../src/modules/channels/discord-monitor.js", () => ({
  DiscordChannelMonitor: vi.fn(function DiscordChannelMonitorMock() {
    discordChannelMonitor();
    return {
      start: discordChannelMonitorStart,
    };
  }),
}));

const createBaseContext = (): unknown =>
  ({
    container: {
      db: {},
      artifactStore: {},
      sessionDal: {},
      memoryDal: {},
      approvalDal: {},
      identityScopeDal: {},
    },
    logger,
    deploymentConfig: {
      channels: {
        typingMode: "never",
        typingRefreshMs: 1_000,
        typingAutomationEnabled: false,
      },
    },
    instanceId: "gateway-instance",
  }) as unknown;

const createProtocolRuntime = (): unknown =>
  ({
    protocolDeps: {
      eventsEnabled: true,
    },
  }) as unknown;

describe("startChannelRuntimeBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds base channel runtime bundle when no agents are configured", async () => {
    const { startChannelRuntimeBundle } =
      await import("../../src/bootstrap/runtime-builders-channels.js");

    const bundle = await startChannelRuntimeBundle({
      context: createBaseContext() as never,
      protocol: createProtocolRuntime() as never,
      agents: undefined,
    });

    expect(channelConfigDal).toHaveBeenCalledTimes(1);
    expect(telegramChannelRuntime).toHaveBeenCalledTimes(1);
    expect(googleChatChannelRuntime).toHaveBeenCalledTimes(1);
    expect(routingConfigDal).toHaveBeenCalledTimes(1);
    expect(telegramPollingStateDal).toHaveBeenCalledTimes(1);
    expect(telegramChannelQueue).not.toHaveBeenCalled();
    expect(telegramChannelProcessor).not.toHaveBeenCalled();
    expect(telegramPollingMonitor).not.toHaveBeenCalled();
    expect(discordChannelMonitor).not.toHaveBeenCalled();
    expect(bundle.telegramProcessor).toBeUndefined();
    expect(bundle.telegramPollingMonitor).toBeUndefined();
    expect(bundle.discordMonitor).toBeUndefined();
    expect(bundle.channelConfigDal).toBeDefined();
    expect(bundle.telegramRuntime).toBeDefined();
    expect(bundle.googleChatRuntime).toBeDefined();
  });

  it("builds full agent runtime bundle when agents are configured", async () => {
    const { startChannelRuntimeBundle } =
      await import("../../src/bootstrap/runtime-builders-channels.js");

    await startChannelRuntimeBundle({
      context: createBaseContext() as never,
      protocol: createProtocolRuntime() as never,
      agents: {} as never,
    });

    expect(telegramChannelQueue).toHaveBeenCalledTimes(1);
    expect(telegramChannelProcessor).toHaveBeenCalledTimes(1);
    expect(telegramPollingMonitor).toHaveBeenCalledTimes(1);
    expect(discordChannelMonitor).toHaveBeenCalledTimes(1);
    expect(telegramProcessorStart).toHaveBeenCalledTimes(1);
    expect(telegramPollingMonitorStart).toHaveBeenCalledTimes(1);
    expect(discordChannelMonitorStart).toHaveBeenCalledTimes(1);
  });
});
