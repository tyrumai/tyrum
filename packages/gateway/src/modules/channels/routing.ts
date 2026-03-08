export type TelegramRoutingConfig = {
  default_agent_key?: string;
  threads?: Record<string, string>;
};

export type RoutingConfig = {
  v: number;
  telegram?: TelegramRoutingConfig;
};

export function resolveTelegramAgentId(config: RoutingConfig, threadId: string): string {
  const t = threadId.trim();
  const telegram = config.telegram;
  if (telegram?.threads && t && telegram.threads[t]) {
    return String(telegram.threads[t]).trim() || telegram.default_agent_key?.trim() || "default";
  }
  return telegram?.default_agent_key?.trim() || "default";
}
