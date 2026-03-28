import { z } from "zod";
import { UuidSchema } from "./common.js";

const KeyPart = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^:]+$/, "key parts must not contain ':'");

// ---------------------------------------------------------------------------
// Tenant/agent/workspace identity
// ---------------------------------------------------------------------------

/** Stable external handle (maps to `tenants.tenant_key`). */
export const TenantKey = KeyPart;
export type TenantKey = z.infer<typeof TenantKey>;

/** Stable external handle (maps to `agents.agent_key`). */
export const AgentKey = KeyPart;
export type AgentKey = z.infer<typeof AgentKey>;

/** Channel type (for example `telegram`, `discord`). */
export const ChannelKey = KeyPart;
export type ChannelKey = z.infer<typeof ChannelKey>;

/** Connector/account instance identifier (for example `default`, `work`). */
export const AccountId = KeyPart;
export type AccountId = z.infer<typeof AccountId>;

/** Sender identity for direct-message scopes. */
export const PeerId = KeyPart;
export type PeerId = z.infer<typeof PeerId>;

/** Provider-native thread/container id (for example Telegram chat id). */
export const ThreadId = KeyPart;
export type ThreadId = z.infer<typeof ThreadId>;

export const CronJobId = KeyPart;
export type CronJobId = z.infer<typeof CronJobId>;

export const NodeId = KeyPart;
export type NodeId = z.infer<typeof NodeId>;

/**
 * Workspace stable external handle (maps to `workspaces.workspace_key`).
 *
 * We constrain this to a DNS-label compatible format so it can be used safely
 * in Kubernetes resource names (for example PVC names) and filesystem paths.
 */
export const WorkspaceKey = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(
    /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
    "workspace key must be a DNS-label (lowercase alnum and '-')",
  );
export type WorkspaceKey = z.infer<typeof WorkspaceKey>;

export const DEFAULT_WORKSPACE_KEY = "default" as const;

/** Internal tenant UUID (maps to `tenants.tenant_id`). */
export const TenantId = UuidSchema;
export type TenantId = z.infer<typeof TenantId>;

/** Internal agent UUID (maps to `agents.agent_id`). */
export const AgentId = UuidSchema;
export type AgentId = z.infer<typeof AgentId>;

/** Internal workspace UUID (maps to `workspaces.workspace_id`). */
export const WorkspaceId = UuidSchema;
export type WorkspaceId = z.infer<typeof WorkspaceId>;

// ---------------------------------------------------------------------------
// DM scope + canonical conversation key construction
// ---------------------------------------------------------------------------

export const DmScope = z.enum([
  "shared",
  "per_peer",
  "per_channel_peer",
  "per_account_channel_peer",
]);
export type DmScope = z.infer<typeof DmScope>;

export function resolveDmScope(opts?: {
  configured?: DmScope | undefined;
  distinctDmSenders?: number | undefined;
}): DmScope {
  if (opts?.configured) return opts.configured;
  const distinct = opts?.distinctDmSenders;
  if (typeof distinct === "number" && Number.isFinite(distinct)) {
    return distinct > 1 ? "per_account_channel_peer" : "shared";
  }
  // Secure-by-default: when sender cardinality is unknown, avoid collapsing DMs.
  return "per_account_channel_peer";
}

type BuildDmConversationKeyInput = {
  agentKey: string;
  container: "dm";
  channel: string;
  account?: string;
  peerId?: string;
  dmScope?: DmScope;
  distinctDmSenders?: number;
};

type BuildContainerConversationKeyInput = {
  agentKey: string;
  container: "group" | "channel";
  channel: string;
  account?: string;
  id: string;
};

export type BuildAgentConversationKeyInput =
  | BuildDmConversationKeyInput
  | BuildContainerConversationKeyInput;

function parseRequiredPeer(peerId: string | undefined): PeerId {
  if (!peerId || peerId.trim().length === 0) {
    throw new Error("peerId is required for non-shared dm scopes");
  }
  return PeerId.parse(peerId);
}

export function buildAgentConversationKey(input: BuildAgentConversationKeyInput): string {
  const agentKey = AgentKey.parse(input.agentKey);

  if (input.container === "dm") {
    const scope = resolveDmScope({
      configured: input.dmScope,
      distinctDmSenders: input.distinctDmSenders,
    });
    if (scope === "shared") {
      return `agent:${agentKey}:main`;
    }

    const peerId = parseRequiredPeer(input.peerId);
    if (scope === "per_peer") {
      return `agent:${agentKey}:dm:${peerId}`;
    }

    const channel = ChannelKey.parse(input.channel);
    if (scope === "per_channel_peer") {
      return `agent:${agentKey}:${channel}:dm:${peerId}`;
    }

    const account = AccountId.parse(input.account ?? "default");
    return `agent:${agentKey}:${channel}:${account}:dm:${peerId}`;
  }

  const channel = ChannelKey.parse(input.channel);
  const account = AccountId.parse(input.account ?? "default");
  const id = ThreadId.parse(input.id);
  return `agent:${agentKey}:${channel}:${account}:${input.container}:${id}`;
}

// ---------------------------------------------------------------------------
// Key strings (canonical storage / routing form)
// ---------------------------------------------------------------------------

// Direct/shared canonical: agent:<agentId>:main
export const AgentMainKey = z
  .string()
  .regex(/^agent:[^:]+:main$/, "agent main key must be agent:<agentId>:main");
export type AgentMainKey = z.infer<typeof AgentMainKey>;

// Direct/per-peer: agent:<agentId>:dm:<peerId>
export const AgentDmPerPeerKey = z
  .string()
  .regex(/^agent:[^:]+:dm:[^:]+$/, "agent dm per-peer key must be agent:<agentId>:dm:<peerId>");
export type AgentDmPerPeerKey = z.infer<typeof AgentDmPerPeerKey>;

// Direct/per-channel-peer: agent:<agentId>:<channel>:dm:<peerId>
export const AgentDmPerChannelPeerKey = z
  .string()
  .regex(
    /^agent:[^:]+:[^:]+:dm:[^:]+$/,
    "agent dm per-channel-peer key must be agent:<agentId>:<channel>:dm:<peerId>",
  );
export type AgentDmPerChannelPeerKey = z.infer<typeof AgentDmPerChannelPeerKey>;

// Direct/per-account-channel-peer: agent:<agentId>:<channel>:<account>:dm:<peerId>
export const AgentDmPerAccountChannelPeerKey = z
  .string()
  .regex(
    /^agent:[^:]+:[^:]+:[^:]+:dm:[^:]+$/,
    "agent dm per-account-channel-peer key must be agent:<agentId>:<channel>:<account>:dm:<peerId>",
  );
export type AgentDmPerAccountChannelPeerKey = z.infer<typeof AgentDmPerAccountChannelPeerKey>;

// Canonical group/channel include channel + account + container id.
export const AgentGroupKey = z
  .string()
  .regex(
    /^agent:[^:]+:[^:]+:[^:]+:group:[^:]+$/,
    "agent group key must be agent:<agentId>:<channel>:<account>:group:<id>",
  );
export type AgentGroupKey = z.infer<typeof AgentGroupKey>;

export const AgentChannelKey = z
  .string()
  .regex(
    /^agent:[^:]+:[^:]+:[^:]+:channel:[^:]+$/,
    "agent channel key must be agent:<agentId>:<channel>:<account>:channel:<id>",
  );
export type AgentChannelKey = z.infer<typeof AgentChannelKey>;

export const AgentConversationKey = z.union([
  AgentMainKey,
  AgentDmPerPeerKey,
  AgentDmPerChannelPeerKey,
  AgentDmPerAccountChannelPeerKey,
  AgentGroupKey,
  AgentChannelKey,
]);
export type AgentConversationKey = z.infer<typeof AgentConversationKey>;

export const CronKey = z.string().regex(/^cron:[^:]+$/, "cron key must be cron:<jobId>");
export type CronKey = z.infer<typeof CronKey>;

export const HookKey = z.string().refine((value) => {
  if (!value.startsWith("hook:")) return false;
  const uuid = value.slice("hook:".length);
  return UuidSchema.safeParse(uuid).success;
}, "hook key must be hook:<uuid>");
export type HookKey = z.infer<typeof HookKey>;

export const NodeKey = z.string().regex(/^node:[^:]+$/, "node key must be node:<nodeId>");
export type NodeKey = z.infer<typeof NodeKey>;

export const TyrumKey = z.union([AgentConversationKey, CronKey, HookKey, NodeKey]);
export type TyrumKey = z.infer<typeof TyrumKey>;

export const QueueMode = z.enum(["collect", "followup", "steer", "steer_backlog", "interrupt"]);
export type QueueMode = z.infer<typeof QueueMode>;

// ---------------------------------------------------------------------------
// Parsed form (convenience for runtime code)
// ---------------------------------------------------------------------------

export type ParsedTyrumKey =
  | {
      kind: "agent";
      agent_key: AgentKey;
      thread_kind: "main";
    }
  | {
      kind: "agent";
      agent_key: AgentKey;
      thread_kind: "dm";
      dm_scope: "per_peer";
      peer_id: PeerId;
    }
  | {
      kind: "agent";
      agent_key: AgentKey;
      thread_kind: "dm";
      dm_scope: "per_channel_peer";
      channel: ChannelKey;
      peer_id: PeerId;
    }
  | {
      kind: "agent";
      agent_key: AgentKey;
      thread_kind: "dm";
      dm_scope: "per_account_channel_peer";
      channel: ChannelKey;
      account: AccountId;
      peer_id: PeerId;
    }
  | {
      kind: "agent";
      agent_key: AgentKey;
      channel: ChannelKey;
      account?: AccountId;
      thread_kind: "group";
      id: ThreadId;
    }
  | {
      kind: "agent";
      agent_key: AgentKey;
      channel: ChannelKey;
      account?: AccountId;
      thread_kind: "channel";
      id: ThreadId;
    }
  | { kind: "cron"; job_id: CronJobId }
  | { kind: "hook"; uuid: string }
  | { kind: "node"; node_id: NodeId };

export function parseTyrumKey(key: TyrumKey): ParsedTyrumKey {
  const parts = key.split(":");
  const kind = parts[0];

  switch (kind) {
    case "agent": {
      const agentKey = parts[1];
      if (!agentKey) {
        throw new Error(`invalid agent key: ${key}`);
      }

      // agent:<agentId>:main
      if (parts.length === 3 && parts[2] === "main") {
        return {
          kind: "agent",
          agent_key: AgentKey.parse(agentKey),
          thread_kind: "main",
        };
      }

      // agent:<agentId>:dm:<peerId>
      if (parts.length === 4 && parts[2] === "dm") {
        return {
          kind: "agent",
          agent_key: AgentKey.parse(agentKey),
          thread_kind: "dm",
          dm_scope: "per_peer",
          peer_id: PeerId.parse(parts[3]),
        };
      }

      // agent:<agentId>:<channel>:dm:<peerId>
      if (parts.length === 5 && parts[3] === "dm") {
        return {
          kind: "agent",
          agent_key: AgentKey.parse(agentKey),
          thread_kind: "dm",
          dm_scope: "per_channel_peer",
          channel: ChannelKey.parse(parts[2]),
          peer_id: PeerId.parse(parts[4]),
        };
      }

      // agent:<agentId>:<channel>:<account>:dm:<peerId>
      if (parts.length === 6 && parts[4] === "dm") {
        return {
          kind: "agent",
          agent_key: AgentKey.parse(agentKey),
          thread_kind: "dm",
          dm_scope: "per_account_channel_peer",
          channel: ChannelKey.parse(parts[2]),
          account: AccountId.parse(parts[3]),
          peer_id: PeerId.parse(parts[5]),
        };
      }

      // agent:<agentId>:<channel>:<account>:group|channel:<id>
      if (parts.length === 6 && (parts[4] === "group" || parts[4] === "channel")) {
        return {
          kind: "agent",
          agent_key: AgentKey.parse(agentKey),
          channel: ChannelKey.parse(parts[2]),
          account: AccountId.parse(parts[3]),
          thread_kind: parts[4],
          id: ThreadId.parse(parts[5]),
        };
      }

      throw new Error(`invalid agent key: ${key}`);
    }

    case "cron": {
      const jobId = parts[1];
      if (!jobId || parts.length !== 2) {
        throw new Error(`invalid cron key: ${key}`);
      }
      return { kind: "cron", job_id: CronJobId.parse(jobId) };
    }

    case "hook": {
      const uuid = parts[1];
      if (!uuid || parts.length !== 2) {
        throw new Error(`invalid hook key: ${key}`);
      }
      return { kind: "hook", uuid: UuidSchema.parse(uuid) };
    }

    case "node": {
      const nodeId = parts[1];
      if (!nodeId || parts.length !== 2) {
        throw new Error(`invalid node key: ${key}`);
      }
      return { kind: "node", node_id: NodeId.parse(nodeId) };
    }

    default:
      throw new Error(`unknown key kind: ${String(kind)}`);
  }
}
