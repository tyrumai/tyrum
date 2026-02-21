import { z } from "zod";
import { UuidSchema } from "./common.js";

const KeyPart = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^:]+$/, "key parts must not contain ':'");

export const AgentId = KeyPart;
export type AgentId = z.infer<typeof AgentId>;

/** Channel type identifier (e.g. `telegram`, `slack`). */
export const ChannelKey = KeyPart;
export type ChannelKey = z.infer<typeof ChannelKey>;

/** Connector/account instance identifier (e.g. `default`, `work`). */
export const AccountId = KeyPart;
export type AccountId = z.infer<typeof AccountId>;

/** Provider-native peer id for direct messages (e.g. Telegram user id). */
export const PeerId = KeyPart;
export type PeerId = z.infer<typeof PeerId>;

/** Provider-native thread/container id (e.g. Telegram chat id). */
export const ThreadId = KeyPart;
export type ThreadId = z.infer<typeof ThreadId>;

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

export const AgentMainKey = z
  .string()
  .regex(/^agent:[^:]+:main$/, "agent main key must be agent:<agentId>:main");
export type AgentMainKey = z.infer<typeof AgentMainKey>;

export const AgentDmPerPeerKey = z
  .string()
  .regex(
    /^agent:[^:]+:dm:[^:]+$/,
    "agent dm key must be agent:<agentId>:dm:<peerId>",
  );
export type AgentDmPerPeerKey = z.infer<typeof AgentDmPerPeerKey>;

export const AgentDmPerChannelPeerKey = z
  .string()
  .regex(
    /^agent:[^:]+:[^:]+:dm:[^:]+$/,
    "agent dm key must be agent:<agentId>:<channel>:dm:<peerId>",
  );
export type AgentDmPerChannelPeerKey = z.infer<typeof AgentDmPerChannelPeerKey>;

export const AgentDmPerAccountChannelPeerKey = z
  .string()
  .regex(
    /^agent:[^:]+:[^:]+:[^:]+:dm:[^:]+$/,
    "agent dm key must be agent:<agentId>:<channel>:<account>:dm:<peerId>",
  );
export type AgentDmPerAccountChannelPeerKey = z.infer<typeof AgentDmPerAccountChannelPeerKey>;

export const AgentDmKey = z.union([
  AgentDmPerPeerKey,
  AgentDmPerChannelPeerKey,
  AgentDmPerAccountChannelPeerKey,
]);
export type AgentDmKey = z.infer<typeof AgentDmKey>;

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
    }
  | {
      kind: "agent";
      agent_id: AgentId;
      thread_kind: "dm";
      peer_id: PeerId;
      channel?: ChannelKey;
      account_id?: AccountId;
    }
  | {
      kind: "agent";
      agent_id: AgentId;
      channel: ChannelKey;
      account_id: AccountId;
      thread_kind: "group";
      id: ThreadId;
    }
  | {
      kind: "agent";
      agent_id: AgentId;
      channel: ChannelKey;
      account_id: AccountId;
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
      const agentId = parts[1];
      const scope = parts[2];
      if (!agentId || !scope) {
        throw new Error(`invalid agent key: ${key}`);
      }

      if (scope === "main" && parts.length === 3) {
        return {
          kind: "agent",
          agent_id: AgentId.parse(agentId),
          thread_kind: "main",
        };
      }

      if (scope === "dm" && parts.length === 4) {
        const peerId = parts[3];
        if (!peerId) throw new Error(`invalid agent dm key: ${key}`);
        return {
          kind: "agent",
          agent_id: AgentId.parse(agentId),
          thread_kind: "dm",
          peer_id: PeerId.parse(peerId),
        };
      }

      // agent:<agentId>:<channel>:dm:<peerId>
      if (parts.length === 5 && parts[3] === "dm") {
        const channel = parts[2];
        const peerId = parts[4];
        if (!channel || !peerId) throw new Error(`invalid agent dm key: ${key}`);
        return {
          kind: "agent",
          agent_id: AgentId.parse(agentId),
          thread_kind: "dm",
          channel: ChannelKey.parse(channel),
          peer_id: PeerId.parse(peerId),
        };
      }

      if (parts.length === 6) {
        const channel = parts[2];
        const account = parts[3];
        const scope6 = parts[4];
        const id = parts[5];
        if (!channel || !account || !scope6 || !id) {
          throw new Error(`invalid agent key: ${key}`);
        }

        if (scope6 === "dm") {
          return {
            kind: "agent",
            agent_id: AgentId.parse(agentId),
            thread_kind: "dm",
            channel: ChannelKey.parse(channel),
            account_id: AccountId.parse(account),
            peer_id: PeerId.parse(id),
          };
        }

        if (scope6 === "group" || scope6 === "channel") {
          return {
            kind: "agent",
            agent_id: AgentId.parse(agentId),
            channel: ChannelKey.parse(channel),
            account_id: AccountId.parse(account),
            thread_kind: scope6,
            id: ThreadId.parse(id),
          };
        }
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
