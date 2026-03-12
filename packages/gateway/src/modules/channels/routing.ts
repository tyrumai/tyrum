export type TelegramAccountRoutingConfig = {
  default_agent_key?: string;
  threads?: Record<string, string>;
};

export type TelegramRoutingConfig = {
  accounts?: Record<string, TelegramAccountRoutingConfig>;
};

export type RoutingConfig = {
  v: number;
  telegram?: TelegramRoutingConfig;
};

export function resolveTelegramAgentId(
  config: RoutingConfig,
  accountKey: string,
  threadId: string,
): string {
  const t = threadId.trim();
  const account = config.telegram?.accounts?.[accountKey.trim() || "default"];
  if (account?.threads && t && account.threads[t]) {
    return String(account.threads[t]).trim() || account.default_agent_key?.trim() || "default";
  }
  return account?.default_agent_key?.trim() || "default";
}
