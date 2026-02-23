import { z } from "zod";
import { UuidSchema } from "./common.js";

const KeyPart = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^:]+$/, "key parts must not contain ':'");

export const AgentId = KeyPart;
export type AgentId = z.infer<typeof AgentId>;

/** Connector/channel surface identifier (for example `telegram`, `discord`). */
export const ChannelKey = KeyPart;
export type ChannelKey = z.infer<typeof ChannelKey>;

/** Connector account identifier (for example `default`, `work`). */
export const AccountKey = KeyPart;
export type AccountKey = z.infer<typeof AccountKey>;

/** Provider-native thread/container id (for example Telegram chat id). */
export const ThreadId = KeyPart;
export type ThreadId = z.infer<typeof ThreadId>;

/** Stable sender identity used for DM isolation. */
export const PeerId = KeyPart;
export type PeerId = z.infer<typeof PeerId>;

export const CronJobId = KeyPart;
export type CronJobId = z.infer<typeof CronJobId>;

export const NodeId = KeyPart;
export type NodeId = z.infer<typeof NodeId>;

/**
 * Workspace identifier.
 *
 * We constrain this to a DNS-label compatible format so it can be used safely
 * in Kubernetes resource names (for example PVC names) and filesystem paths.
 */
export const WorkspaceId = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(
    /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/,
    "workspace id must be a DNS-label (lowercase alnum and '-')",
  );
export type WorkspaceId = z.infer<typeof WorkspaceId>;

export const DEFAULT_WORKSPACE_ID = "default" as const;

// ---------------------------------------------------------------------------
// Key strings (canonical storage / routing form)
// ---------------------------------------------------------------------------

const AgentMainSharedKey = z
  .string()
  .regex(/^agent:[^:]+:main$/, "agent main key must be agent:<agentId>:main");

const AgentMainLegacyKey = z
  .string()
  .regex(/^agent:[^:]+:[^:]+:main$/, "agent main key must be agent:<agentId>:<channel>:main");

export const AgentMainKey = z.union([AgentMainSharedKey, AgentMainLegacyKey]);
export type AgentMainKey = z.infer<typeof AgentMainKey>;

const AgentDmPerPeerKey = z
  .string()
  .regex(/^agent:[^:]+:dm:[^:]+$/, "agent dm key must be agent:<agentId>:dm:<peerId>");

const AgentDmPerChannelPeerKey = z
  .string()
  .regex(
    /^agent:[^:]+:[^:]+:dm:[^:]+$/,
    "agent dm key must be agent:<agentId>:<channel>:dm:<peerId>",
  );

const AgentDmPerAccountChannelPeerKey = z
  .string()
  .regex(
    /^agent:[^:]+:[^:]+:[^:]+:dm:[^:]+$/,
    "agent dm key must be agent:<agentId>:<channel>:<account>:dm:<peerId>",
  );

export const AgentDmKey = z.union([
  AgentDmPerPeerKey,
  AgentDmPerChannelPeerKey,
  AgentDmPerAccountChannelPeerKey,
]);
export type AgentDmKey = z.infer<typeof AgentDmKey>;

const AgentGroupScopedKey = z
  .string()
  .regex(
    /^agent:[^:]+:[^:]+:[^:]+:group:[^:]+$/,
    "agent group key must be agent:<agentId>:<channel>:<account>:group:<id>",
  );

const AgentGroupLegacyKey = z
  .string()
  .regex(
    /^agent:[^:]+:[^:]+:group:[^:]+$/,
    "agent group key must be agent:<agentId>:<channel>:group:<id>",
  );

export const AgentGroupKey = z.union([AgentGroupScopedKey, AgentGroupLegacyKey]);
export type AgentGroupKey = z.infer<typeof AgentGroupKey>;

const AgentChannelScopedKey = z
  .string()
  .regex(
    /^agent:[^:]+:[^:]+:[^:]+:channel:[^:]+$/,
    "agent channel key must be agent:<agentId>:<channel>:<account>:channel:<id>",
  );

const AgentChannelLegacyKey = z
  .string()
  .regex(
    /^agent:[^:]+:[^:]+:channel:[^:]+$/,
    "agent channel key must be agent:<agentId>:<channel>:channel:<id>",
  );

export const AgentChannelKey = z.union([AgentChannelScopedKey, AgentChannelLegacyKey]);
export type AgentChannelKey = z.infer<typeof AgentChannelKey>;

export const AgentKey = z.union([AgentMainKey, AgentDmKey, AgentGroupKey, AgentChannelKey]);
export type AgentKey = z.infer<typeof AgentKey>;

export const CronKey = z
  .string()
  .regex(/^cron:[^:]+$/, "cron key must be cron:<jobId>");
export type CronKey = z.infer<typeof CronKey>;

export const HookKey = z
  .string()
  .refine((value) => {
    if (!value.startsWith("hook:")) return false;
    const uuid = value.slice("hook:".length);
    return UuidSchema.safeParse(uuid).success;
  }, "hook key must be hook:<uuid>");
export type HookKey = z.infer<typeof HookKey>;

export const NodeKey = z
  .string()
  .regex(/^node:[^:]+$/, "node key must be node:<nodeId>");
export type NodeKey = z.infer<typeof NodeKey>;

export const TyrumKey = z.union([AgentKey, CronKey, HookKey, NodeKey]);
export type TyrumKey = z.infer<typeof TyrumKey>;

// ---------------------------------------------------------------------------
// Lanes and queue modes
// ---------------------------------------------------------------------------

export const Lane = z.enum(["main", "cron", "subagent"]);
export type Lane = z.infer<typeof Lane>;

export const QueueMode = z.enum(["collect", "followup", "steer", "steer_backlog", "interrupt"]);
export type QueueMode = z.infer<typeof QueueMode>;

// ---------------------------------------------------------------------------
// Parsed form (convenience for runtime code)
// ---------------------------------------------------------------------------

export type ParsedTyrumKey =
  | {
      kind: "agent";
      agent_id: AgentId;
      thread_kind: "main";
      channel?: ChannelKey;
    }
  | {
      kind: "agent";
      agent_id: AgentId;
      thread_kind: "dm";
      peer_id: PeerId;
      channel?: ChannelKey;
      account?: AccountKey;
    }
  | {
      kind: "agent";
      agent_id: AgentId;
      channel: ChannelKey;
      thread_kind: "group";
      id: ThreadId;
      account?: AccountKey;
    }
  | {
      kind: "agent";
      agent_id: AgentId;
      channel: ChannelKey;
      thread_kind: "channel";
      id: ThreadId;
      account?: AccountKey;
    }
  | { kind: "cron"; job_id: CronJobId }
  | { kind: "hook"; uuid: string }
  | { kind: "node"; node_id: NodeId };

export function parseTyrumKey(key: TyrumKey): ParsedTyrumKey {
  const parts = key.split(":");
  const kind = parts[0];

  switch (kind) {
    case "agent": {
      const agentId = parts[1];
      if (!agentId) {
        throw new Error(`invalid agent key: ${key}`);
      }
      const parsedAgentId = AgentId.parse(agentId);

      if (parts.length === 3 && parts[2] === "main") {
        return {
          kind: "agent",
          agent_id: parsedAgentId,
          thread_kind: "main",
        };
      }

      if (parts.length === 4) {
        const part2 = parts[2];
        const part3 = parts[3];
        if (!part2 || !part3) {
          throw new Error(`invalid agent key: ${key}`);
        }

        if (part3 === "main") {
          return {
            kind: "agent",
            agent_id: parsedAgentId,
            channel: ChannelKey.parse(part2),
            thread_kind: "main",
          };
        }

        if (part2 === "dm") {
          return {
            kind: "agent",
            agent_id: parsedAgentId,
            thread_kind: "dm",
            peer_id: PeerId.parse(part3),
          };
        }
      }

      if (parts.length === 5) {
        const channel = parts[2];
        const scope = parts[3];
        const id = parts[4];
        if (!channel || !scope || !id) {
          throw new Error(`invalid agent key: ${key}`);
        }

        if (scope === "dm") {
          return {
            kind: "agent",
            agent_id: parsedAgentId,
            channel: ChannelKey.parse(channel),
            thread_kind: "dm",
            peer_id: PeerId.parse(id),
          };
        }

        if (scope === "group") {
          return {
            kind: "agent",
            agent_id: parsedAgentId,
            channel: ChannelKey.parse(channel),
            thread_kind: "group",
            id: ThreadId.parse(id),
          };
        }

        if (scope === "channel") {
          return {
            kind: "agent",
            agent_id: parsedAgentId,
            channel: ChannelKey.parse(channel),
            thread_kind: "channel",
            id: ThreadId.parse(id),
          };
        }
      }

      if (parts.length === 6) {
        const channel = parts[2];
        const account = parts[3];
        const scope = parts[4];
        const id = parts[5];
        if (!channel || !account || !scope || !id) {
          throw new Error(`invalid agent key: ${key}`);
        }

        if (scope === "dm") {
          return {
            kind: "agent",
            agent_id: parsedAgentId,
            channel: ChannelKey.parse(channel),
            account: AccountKey.parse(account),
            thread_kind: "dm",
            peer_id: PeerId.parse(id),
          };
        }

        if (scope === "group") {
          return {
            kind: "agent",
            agent_id: parsedAgentId,
            channel: ChannelKey.parse(channel),
            account: AccountKey.parse(account),
            thread_kind: "group",
            id: ThreadId.parse(id),
          };
        }

        if (scope === "channel") {
          return {
            kind: "agent",
            agent_id: parsedAgentId,
            channel: ChannelKey.parse(channel),
            account: AccountKey.parse(account),
            thread_kind: "channel",
            id: ThreadId.parse(id),
          };
        }
      }

      throw new Error(`invalid agent key format: ${key}`);
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
