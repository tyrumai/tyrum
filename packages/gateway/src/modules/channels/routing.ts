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

export type TelegramAgentResolutionSource =
  | "routing_thread_override"
  | "routing_default_agent"
  | "identity_primary";

export async function resolveTelegramAgent(input: {
  config: RoutingConfig;
  tenantId: string;
  accountKey: string;
  threadId: string;
  identityScopeDal?: IdentityScopeDal;
}): Promise<{ agentId: string; source: TelegramAgentResolutionSource }> {
  const { config, tenantId, accountKey, threadId, identityScopeDal } = input;
  const t = threadId.trim();
  const account = config.telegram?.accounts?.[accountKey.trim() || "default"];
  if (account?.threads && t && account.threads[t]) {
    const threadAgentKey = String(account.threads[t]).trim();
    if (threadAgentKey) {
      return { agentId: threadAgentKey, source: "routing_thread_override" };
    }
  }
  const accountAgentKey = account?.default_agent_key?.trim();
  if (accountAgentKey) {
    return { agentId: accountAgentKey, source: "routing_default_agent" };
  }
  if (!identityScopeDal) {
    throw new Error("identity scope is required to resolve the primary telegram agent");
  }
  return {
    agentId: await requirePrimaryAgentKey(identityScopeDal, tenantId),
    source: "identity_primary",
  };
}

export async function resolveTelegramAgentId(input: {
  config: RoutingConfig;
  tenantId: string;
  accountKey: string;
  threadId: string;
  identityScopeDal?: IdentityScopeDal;
}): Promise<string> {
  const resolved = await resolveTelegramAgent(input);
  return resolved.agentId;
}
