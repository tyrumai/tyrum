import type { IdentityScopeDal } from "../identity/scope.js";
import { requirePrimaryAgentKey } from "../identity/scope.js";

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

export async function resolveTelegramAgentId(input: {
  config: RoutingConfig;
  tenantId: string;
  accountKey: string;
  threadId: string;
  identityScopeDal: IdentityScopeDal;
}): Promise<string> {
  const { config, tenantId, accountKey, threadId, identityScopeDal } = input;
  const t = threadId.trim();
  const account = config.telegram?.accounts?.[accountKey.trim() || "default"];
  if (account?.threads && t && account.threads[t]) {
    const threadAgentKey = String(account.threads[t]).trim();
    if (threadAgentKey) {
      return threadAgentKey;
    }
  }
  const accountAgentKey = account?.default_agent_key?.trim();
  if (accountAgentKey) {
    return accountAgentKey;
  }
  return await requirePrimaryAgentKey(identityScopeDal, tenantId);
}
