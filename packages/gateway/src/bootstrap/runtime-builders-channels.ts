import type { AgentRegistry } from "../modules/agent/registry.js";
import { ChannelConfigDal } from "../modules/channels/channel-config-dal.js";
import { DiscordChannelMonitor } from "../modules/channels/discord-monitor.js";
import { GoogleChatChannelRuntime } from "../modules/channels/googlechat-runtime.js";
import { TelegramChannelProcessor } from "../modules/channels/telegram.js";
import { TelegramChannelRuntime } from "../modules/channels/telegram-runtime.js";
import type { GatewayBootContext, ProtocolRuntime } from "./runtime-shared.js";

export type ChannelRuntimeBundle = {
  channelConfigDal: ChannelConfigDal;
  telegramRuntime: TelegramChannelRuntime;
  googleChatRuntime: GoogleChatChannelRuntime;
  telegramProcessor?: TelegramChannelProcessor;
  discordMonitor?: DiscordChannelMonitor;
};

export function startChannelRuntimeBundle(input: {
  context: GatewayBootContext;
  protocol: ProtocolRuntime;
  agents: AgentRegistry | undefined;
}): ChannelRuntimeBundle {
  const { context, protocol, agents } = input;
  const channelConfigDal = new ChannelConfigDal(context.container.db);
  const telegramRuntime = new TelegramChannelRuntime(
    channelConfigDal,
    context.container.artifactStore,
  );
  const googleChatRuntime = new GoogleChatChannelRuntime(channelConfigDal);

  const telegramProcessor = agents
    ? new TelegramChannelProcessor({
        db: context.container.db,
        sessionDal: context.container.sessionDal,
        agents,
        owner: context.instanceId,
        logger: context.logger,
        typingMode: context.deploymentConfig.channels.typingMode,
        typingRefreshMs: context.deploymentConfig.channels.typingRefreshMs,
        typingAutomationEnabled: context.deploymentConfig.channels.typingAutomationEnabled,
        memoryDal: context.container.memoryDal,
        approvalDal: context.container.approvalDal,
        protocolDeps: protocol.protocolDeps,
        artifactStore: context.container.artifactStore,
        listEgressConnectors: async (tenantId) =>
          await telegramRuntime.listEgressConnectors(tenantId),
      })
    : undefined;
  telegramProcessor?.start();

  const discordMonitor = agents
    ? new DiscordChannelMonitor({
        channelConfigDal,
        agents,
        logger: context.logger,
      })
    : undefined;
  discordMonitor?.start();

  return {
    channelConfigDal,
    telegramRuntime,
    googleChatRuntime,
    telegramProcessor,
    discordMonitor,
  };
}
