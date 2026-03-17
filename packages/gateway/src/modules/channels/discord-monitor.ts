import type { RawData } from "ws";
import WebSocket from "ws";
import type { AgentRegistry } from "../agent/registry.js";
import type { Logger } from "../observability/logger.js";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import { ChannelConfigDal, type StoredDiscordChannelConfig } from "./channel-config-dal.js";

const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
const DISCORD_GATEWAY_INTENTS = 1 + 512 + 4096 + 32768;
const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;
const DEFAULT_RECONNECT_DELAY_MS = 5_000;
const DISCORD_MESSAGE_LIMIT = 2_000;

type DiscordAuthor = {
  id?: string;
  username?: string;
  global_name?: string | null;
  bot?: boolean;
};

type DiscordMessageCreateEvent = {
  id?: string;
  channel_id?: string;
  guild_id?: string;
  content?: string;
  author?: DiscordAuthor;
  member?: { nick?: string | null };
  parent_id?: string;
};

type DiscordGatewayPayload = {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
};

type WebSocketFactory = (url: string) => WebSocket;

function asDiscordMessageCreateEvent(value: unknown): DiscordMessageCreateEvent | undefined {
  return value && typeof value === "object" ? (value as DiscordMessageCreateEvent) : undefined;
}

function parseGatewayPayload(raw: RawData): DiscordGatewayPayload | undefined {
  const text =
    typeof raw === "string"
      ? raw
      : raw instanceof ArrayBuffer
        ? Buffer.from(raw).toString("utf-8")
        : Array.isArray(raw)
          ? Buffer.concat(raw).toString("utf-8")
          : Buffer.from(raw).toString("utf-8");
  try {
    return JSON.parse(text) as DiscordGatewayPayload;
  } catch {
    return undefined;
  }
}

function splitDiscordMessage(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  const chunks: string[] = [];
  let remaining = trimmed;
  while (remaining.length > DISCORD_MESSAGE_LIMIT) {
    let splitAt = remaining.lastIndexOf("\n", DISCORD_MESSAGE_LIMIT);
    if (splitAt < DISCORD_MESSAGE_LIMIT / 2) {
      splitAt = remaining.lastIndexOf(" ", DISCORD_MESSAGE_LIMIT);
    }
    if (splitAt < DISCORD_MESSAGE_LIMIT / 2) {
      splitAt = DISCORD_MESSAGE_LIMIT;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

function isDiscordMessageAllowed(
  account: StoredDiscordChannelConfig,
  message: DiscordMessageCreateEvent,
): boolean {
  const authorId = message.author?.id?.trim();
  if (
    account.allowed_user_ids.length > 0 &&
    (!authorId || !account.allowed_user_ids.includes(authorId))
  ) {
    return false;
  }
  const guildId = message.guild_id?.trim();
  if (!guildId || account.allowed_channels.length === 0) {
    return true;
  }
  const channelId = message.channel_id?.trim();
  const parentId = message.parent_id?.trim();
  const allowed = new Set(account.allowed_channels);
  return (
    allowed.has(`guild:${guildId}`) ||
    (channelId ? allowed.has(`guild:${guildId}/channel:${channelId}`) : false) ||
    (parentId ? allowed.has(`guild:${guildId}/channel:${parentId}`) : false)
  );
}

async function sendDiscordReply(params: {
  token: string;
  channelId: string;
  reply: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const chunks = splitDiscordMessage(params.reply);
  if (chunks.length === 0) {
    return;
  }
  for (const chunk of chunks) {
    const response = await (params.fetchImpl ?? fetch)(
      `https://discord.com/api/v10/channels/${encodeURIComponent(params.channelId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${params.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          content: chunk,
          allowed_mentions: { parse: [] },
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `discord reply delivery failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
  }
}

export async function handleDiscordMessageCreate(params: {
  message: DiscordMessageCreateEvent;
  account: StoredDiscordChannelConfig;
  agents: AgentRegistry;
  logger?: Logger;
  tenantId?: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const authorId = params.message.author?.id?.trim();
  const channelId = params.message.channel_id?.trim();
  const token = params.account.bot_token?.trim();
  const content = params.message.content?.trim() ?? "";
  if (!authorId || !channelId || !token || !content) {
    return;
  }
  if (params.message.author?.bot) {
    return;
  }
  if (!isDiscordMessageAllowed(params.account, params.message)) {
    params.logger?.info("discord.monitor.sender_blocked", {
      account_key: params.account.account_key,
      sender_id: authorId,
      channel_id: channelId,
      guild_id: params.message.guild_id ?? null,
    });
    return;
  }

  const isDm = !params.message.guild_id?.trim();
  const containerId = isDm ? authorId : channelId;
  const display =
    params.message.member?.nick?.trim() ||
    params.message.author?.global_name?.trim() ||
    params.message.author?.username?.trim();

  const runtime = await params.agents.getRuntime({
    tenantId: params.tenantId ?? DEFAULT_TENANT_ID,
    agentKey: params.account.agent_key,
  });
  const result = await runtime.turn({
    channel: "discord",
    thread_id: containerId,
    envelope: {
      message_id: params.message.id?.trim() || `${channelId}:${Date.now()}`,
      received_at: new Date().toISOString(),
      delivery: {
        channel: "discord",
        account: params.account.account_key,
      },
      container: {
        kind: isDm ? "dm" : "group",
        id: containerId,
      },
      sender: {
        id: authorId,
        ...(display ? { display } : {}),
      },
      content: {
        text: content,
        attachments: [],
      },
      provenance: ["user"],
    },
  });
  await sendDiscordReply({
    token,
    channelId,
    reply: result.reply,
    fetchImpl: params.fetchImpl,
  });
}

function accountFingerprint(account: StoredDiscordChannelConfig): string {
  return JSON.stringify({
    account_key: account.account_key,
    agent_key: account.agent_key,
    bot_token: account.bot_token ?? null,
    allowed_user_ids: account.allowed_user_ids,
    allowed_channels: account.allowed_channels,
  });
}

class DiscordGatewayConnection {
  private socket: WebSocket | null = null;
  private sequence: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly deps: {
      config: StoredDiscordChannelConfig;
      agents: AgentRegistry;
      logger?: Logger;
      tenantId: string;
      fetchImpl?: typeof fetch;
      createWebSocket?: WebSocketFactory;
      reconnectDelayMs: number;
    },
  ) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.socket) {
      try {
        this.socket.close();
      } catch {
        // ignore close errors during shutdown
      }
      this.socket = null;
    }
  }

  private connect(): void {
    this.clearReconnectTimer();
    const socket = (this.deps.createWebSocket ?? ((url) => new WebSocket(url)))(
      DISCORD_GATEWAY_URL,
    );
    this.socket = socket;

    socket.on("message", (raw) => {
      void this.handleGatewayMessage(raw);
    });
    socket.on("close", (code) => {
      this.clearHeartbeatTimer();
      this.socket = null;
      if (this.stopped) {
        return;
      }
      if (code === 4004 || code === 4013 || code === 4014) {
        this.deps.logger?.error("discord.monitor.gateway_closed_fatal", {
          account_key: this.deps.config.account_key,
          code,
        });
        this.stopped = true;
        return;
      }
      this.scheduleReconnect();
    });
    socket.on("error", (err) => {
      this.deps.logger?.warn("discord.monitor.gateway_error", {
        account_key: this.deps.config.account_key,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  private async handleGatewayMessage(raw: RawData): Promise<void> {
    const payload = parseGatewayPayload(raw);
    if (!payload) {
      return;
    }
    if (typeof payload.s === "number") {
      this.sequence = payload.s;
    }

    switch (payload.op) {
      case 0: {
        if (payload.t === "MESSAGE_CREATE") {
          const message = asDiscordMessageCreateEvent(payload.d);
          if (!message) {
            return;
          }
          try {
            await handleDiscordMessageCreate({
              message,
              account: this.deps.config,
              agents: this.deps.agents,
              logger: this.deps.logger,
              tenantId: this.deps.tenantId,
              fetchImpl: this.deps.fetchImpl,
            });
          } catch (err) {
            this.deps.logger?.warn("discord.monitor.message_process_failed", {
              account_key: this.deps.config.account_key,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return;
      }
      case 1:
        this.sendHeartbeat();
        return;
      case 7:
      case 9:
        this.reconnect();
        return;
      case 10: {
        const data = payload.d as { heartbeat_interval?: number } | undefined;
        const heartbeatIntervalMs =
          typeof data?.heartbeat_interval === "number" && data.heartbeat_interval > 0
            ? data.heartbeat_interval
            : 45_000;
        this.startHeartbeat(heartbeatIntervalMs);
        this.identify();
        return;
      }
      default:
        return;
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.clearHeartbeatTimer();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, intervalMs);
    this.heartbeatTimer.unref?.();
  }

  private sendHeartbeat(): void {
    this.send({ op: 1, d: this.sequence });
  }

  private identify(): void {
    const token = this.deps.config.bot_token?.trim();
    if (!token) {
      return;
    }
    this.send({
      op: 2,
      d: {
        token,
        intents: DISCORD_GATEWAY_INTENTS,
        properties: {
          os: process.platform,
          browser: "tyrum",
          device: "tyrum",
        },
      },
    });
  }

  private reconnect(): void {
    if (this.stopped) {
      return;
    }
    this.clearHeartbeatTimer();
    try {
      this.socket?.close();
    } catch {
      // ignore reconnect close errors
    }
    this.socket = null;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.deps.reconnectDelayMs);
    this.reconnectTimer.unref?.();
  }

  private send(payload: unknown): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearHeartbeatTimer(): void {
    if (!this.heartbeatTimer) {
      return;
    }
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearTimers(): void {
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
  }
}

export class DiscordChannelMonitor {
  private readonly connections = new Map<
    string,
    { fingerprint: string; connection: DiscordGatewayConnection }
  >();
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly deps: {
      channelConfigDal: ChannelConfigDal;
      agents: AgentRegistry;
      logger?: Logger;
      tenantId?: string;
      fetchImpl?: typeof fetch;
      createWebSocket?: WebSocketFactory;
      reconcileIntervalMs?: number;
      reconnectDelayMs?: number;
    },
  ) {}

  start(): void {
    if (this.reconcileTimer) {
      return;
    }
    void this.reconcile();
    this.reconcileTimer = setInterval(() => {
      void this.reconcile();
    }, this.deps.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS);
    this.reconcileTimer.unref?.();
  }

  stop(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    for (const managed of this.connections.values()) {
      managed.connection.stop();
    }
    this.connections.clear();
  }

  private async reconcile(): Promise<void> {
    const tenantId = this.deps.tenantId ?? DEFAULT_TENANT_ID;
    const configs = (await this.deps.channelConfigDal.list(tenantId)).flatMap((config) =>
      config.channel === "discord" && config.bot_token?.trim() ? [config] : [],
    );
    const desiredKeys = new Set(configs.map((config) => config.account_key));

    for (const [accountKey, managed] of this.connections.entries()) {
      if (!desiredKeys.has(accountKey)) {
        managed.connection.stop();
        this.connections.delete(accountKey);
      }
    }

    for (const config of configs) {
      const fingerprint = accountFingerprint(config);
      const existing = this.connections.get(config.account_key);
      if (existing && existing.fingerprint === fingerprint) {
        continue;
      }
      existing?.connection.stop();
      const connection = new DiscordGatewayConnection({
        config,
        agents: this.deps.agents,
        logger: this.deps.logger,
        tenantId,
        fetchImpl: this.deps.fetchImpl,
        createWebSocket: this.deps.createWebSocket,
        reconnectDelayMs: this.deps.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS,
      });
      connection.start();
      this.connections.set(config.account_key, { fingerprint, connection });
    }
  }
}
