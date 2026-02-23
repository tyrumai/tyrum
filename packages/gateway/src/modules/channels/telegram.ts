import {
  NormalizedThreadMessage as NormalizedThreadMessageSchema,
  buildAgentSessionKey,
  normalizedContainerKindFromThreadKind,
  parseTyrumKey,
  resolveDmScope,
} from "@tyrum/schemas";
import type { NormalizedThreadMessage } from "@tyrum/schemas";
import type { DmScope } from "@tyrum/schemas";
import type { TelegramBot } from "../ingress/telegram-bot.js";
import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import { ChannelInboxDal, type ChannelInboxRow } from "./inbox-dal.js";
import { ChannelOutboxDal } from "./outbox-dal.js";
import { renderMarkdownForTelegram } from "../markdown/telegram.js";
import type { AgentRegistry } from "../agent/registry.js";
import type { ApprovalDal } from "../approval/dal.js";
import type { ApprovalNotifier } from "../approval/notifier.js";
import type { PolicyService } from "../policy/service.js";

function isFalsyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v.length > 0 && ["0", "false", "off", "no"].includes(v);
}

export function isChannelPipelineEnabled(): boolean {
  return !isFalsyEnvFlag(process.env["TYRUM_CHANNEL_PIPELINE_ENABLED"]);
}

function extractMessageText(normalized: NormalizedThreadMessage): string {
  const content = normalized.message.content;
  if (content.kind === "text") return content.text;
  return content.caption ?? "";
}

function agentIdFromEnv(): string {
  return process.env["TYRUM_AGENT_ID"]?.trim() || "default";
}

function telegramAccountIdFromEnv(): string {
  return process.env["TYRUM_TELEGRAM_ACCOUNT_ID"]?.trim()
    || process.env["TYRUM_TELEGRAM_CHANNEL_KEY"]?.trim()
    || "telegram-1";
}

export function telegramThreadKey(
  thread: NormalizedThreadMessage,
  opts?: {
    agentId?: string;
    accountId?: string;
    channelKey?: string;
    dmScope?: DmScope;
    peerId?: string;
  },
): string;

export function telegramThreadKey(
  threadId: string,
  opts: {
    container: "dm" | "group" | "channel";
    agentId?: string;
    accountId?: string;
    channelKey?: string;
    dmScope?: DmScope;
    peerId?: string;
  },
): string;

export function telegramThreadKey(
  thread: string | NormalizedThreadMessage,
  opts?: {
    agentId?: string;
    accountId?: string;
    channelKey?: string;
    container?: "dm" | "group" | "channel";
    dmScope?: DmScope;
    peerId?: string;
  },
): string {
  const agentId = opts?.agentId?.trim() || agentIdFromEnv();
  const accountId = opts?.accountId?.trim() || opts?.channelKey?.trim() || telegramAccountIdFromEnv();

  if (typeof thread === "string") {
    const container = opts?.container;
    if (!container) {
      throw new Error("container is required when passing a thread id string");
    }

    if (container === "dm") {
      // Telegram private chats use chat id as the peer identity. Callers may override.
      const peerId = opts?.peerId?.trim() || thread.trim();
      const dmScope = resolveDmScope({
        configured: opts?.dmScope ?? "per_account_channel_peer",
      });
      return buildAgentSessionKey({
        agentId,
        container: "dm",
        channel: "telegram",
        account: accountId,
        peerId,
        dmScope,
      });
    }

    return buildAgentSessionKey({
      agentId,
      container,
      channel: "telegram",
      account: accountId,
      id: thread,
    });
  }

  const container = normalizedContainerKindFromThreadKind(thread.thread.kind);
  if (container === "dm") {
    let peerId = opts?.peerId?.trim()
      || thread.thread.id?.trim()
      || thread.message.thread_id?.trim()
      || thread.message.sender?.id?.trim();
    if (!peerId) {
      const msgId = thread.message.id?.trim();
      peerId = msgId ? `msg-${msgId}` : "unknown";
    }
    const dmScope = resolveDmScope({
      configured: opts?.dmScope ?? "per_account_channel_peer",
    });
    return buildAgentSessionKey({
      agentId,
      container: "dm",
      channel: "telegram",
      account: accountId,
      peerId,
      dmScope,
    });
  }

  return buildAgentSessionKey({
    agentId,
    container,
    channel: "telegram",
    account: accountId,
    id: thread.thread.id,
  });
}

async function tryAcquireLaneLease(db: SqlDb, opts: {
  key: string;
  lane: string;
  owner: string;
  now_ms: number;
  ttl_ms: number;
}): Promise<boolean> {
  const expiresAt = opts.now_ms + Math.max(1, opts.ttl_ms);
  return await db.transaction(async (tx) => {
    const inserted = await tx.run(
      `INSERT INTO lane_leases (key, lane, lease_owner, lease_expires_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (key, lane) DO NOTHING`,
      [opts.key, opts.lane, opts.owner, expiresAt],
    );
    if (inserted.changes === 1) return true;

    const updated = await tx.run(
      `UPDATE lane_leases
       SET lease_owner = ?, lease_expires_at_ms = ?
       WHERE key = ? AND lane = ?
         AND (lease_expires_at_ms <= ? OR lease_owner = ?)`,
      [opts.owner, expiresAt, opts.key, opts.lane, opts.now_ms, opts.owner],
    );
    return updated.changes === 1;
  });
}

async function releaseLaneLease(db: SqlDb, opts: { key: string; lane: string; owner: string }): Promise<void> {
  await db.run(
    `DELETE FROM lane_leases
     WHERE key = ? AND lane = ? AND lease_owner = ?`,
    [opts.key, opts.lane, opts.owner],
  );
}

export class TelegramChannelQueue {
  private readonly inbox: ChannelInboxDal;
  private readonly agentId: string;
  private readonly accountId: string;
  private readonly lane: string;
  private readonly dmScope: DmScope;

  constructor(db: SqlDb, opts?: { agentId?: string; accountId?: string; channelKey?: string; lane?: string; dmScope?: DmScope }) {
    this.inbox = new ChannelInboxDal(db);
    this.agentId = opts?.agentId?.trim() || agentIdFromEnv();
    this.accountId = opts?.accountId?.trim() || opts?.channelKey?.trim() || telegramAccountIdFromEnv();
    this.lane = opts?.lane?.trim() || "main";
    this.dmScope = resolveDmScope({ configured: opts?.dmScope ?? "per_account_channel_peer" });
  }

  async enqueue(
    normalized: NormalizedThreadMessage,
    opts?: { agentId?: string; accountId?: string; channelKey?: string; lane?: string; dmScope?: DmScope },
  ): Promise<{ inbox: ChannelInboxRow; deduped: boolean; message_text: string }> {
    const text = extractMessageText(normalized).trim();
    const agentId = opts?.agentId?.trim() || this.agentId;
    const accountId = opts?.accountId?.trim() || opts?.channelKey?.trim() || this.accountId;
    const lane = opts?.lane?.trim() || this.lane;
    const dmScope = opts?.dmScope ?? this.dmScope;
    const key = telegramThreadKey(normalized, {
      agentId,
      accountId,
      dmScope,
    });

    const { row, deduped } = await this.inbox.enqueue({
      source: "telegram",
      thread_id: normalized.thread.id,
      message_id: normalized.message.id,
      key,
      lane,
      received_at_ms: Date.now(),
      payload: normalized,
    });

    return { inbox: row, deduped, message_text: text };
  }
}

export class TelegramChannelProcessor {
  private readonly db: SqlDb;
  private readonly inbox: ChannelInboxDal;
  private readonly outbox: ChannelOutboxDal;
  private readonly agents: AgentRegistry;
  private readonly telegramBot: TelegramBot;
  private readonly owner: string;
  private readonly logger?: Logger;
  private readonly approvalDal?: ApprovalDal;
  private readonly approvalNotifier?: ApprovalNotifier;
  private readonly pollIntervalMs: number;
  private readonly inboxLeaseTtlMs: number;
  private readonly outboxLeaseTtlMs: number;
  private readonly laneLeaseTtlMs: number;
  private readonly debounceMs: number;
  private readonly maxBatch: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private ticking = false;

  constructor(opts: {
    db: SqlDb;
    agents: AgentRegistry;
    telegramBot: TelegramBot;
    owner: string;
    logger?: Logger;
    approvalDal?: ApprovalDal;
    approvalNotifier?: ApprovalNotifier;
    pollIntervalMs?: number;
    inboxLeaseTtlMs?: number;
    outboxLeaseTtlMs?: number;
    laneLeaseTtlMs?: number;
    debounceMs?: number;
    maxBatch?: number;
  }) {
    this.db = opts.db;
    this.inbox = new ChannelInboxDal(opts.db);
    this.outbox = new ChannelOutboxDal(opts.db);
    this.agents = opts.agents;
    this.telegramBot = opts.telegramBot;
    this.owner = opts.owner;
    this.logger = opts.logger;
    this.approvalDal = opts.approvalDal;
    this.approvalNotifier = opts.approvalNotifier;
    this.pollIntervalMs = opts.pollIntervalMs ?? 250;
    this.inboxLeaseTtlMs = opts.inboxLeaseTtlMs ?? 10 * 60 * 1000;
    this.outboxLeaseTtlMs = opts.outboxLeaseTtlMs ?? 60 * 1000;
    this.laneLeaseTtlMs = opts.laneLeaseTtlMs ?? 10 * 60 * 1000;
    this.debounceMs = Math.max(0, opts.debounceMs ?? 1000);
    this.maxBatch = Math.max(1, opts.maxBatch ?? 5);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger?.error("channel.telegram.tick_failed", { error: message });
      });
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const nowMs = Date.now();
      const claimed = await this.inbox.claimNext({
        owner: this.owner,
        now_ms: nowMs,
        lease_ttl_ms: this.inboxLeaseTtlMs,
      });
      if (claimed) {
        const laneAcquired = await tryAcquireLaneLease(this.db, {
          key: claimed.key,
          lane: claimed.lane,
          owner: this.owner,
          now_ms: nowMs,
          ttl_ms: this.laneLeaseTtlMs,
        });
        if (!laneAcquired) {
          await this.inbox.requeue(claimed.inbox_id, this.owner);
        } else {
          try {
            const batch = await this.claimDebouncedBatch(claimed);
            await this.processBatch(batch);
          } finally {
            await releaseLaneLease(this.db, {
              key: claimed.key,
              lane: claimed.lane,
              owner: this.owner,
            });
          }
        }
      }

      // Outbox sends are drained separately so approval-gated sends can resume
      // after an operator decision, even when no new inbound messages arrive.
      for (let i = 0; i < 3; i += 1) {
        const didWork = await this.processOutboxOnce();
        if (!didWork) break;
      }
    } finally {
      this.ticking = false;
    }
  }

  private async processOutboxOnce(): Promise<boolean> {
    if (!this.approvalDal) {
      return await this.sendNextOutbox();
    }

    // Expire approvals before checking gating.
    await this.approvalDal.expireStale();

    const pending = await this.db.get<{ approval_id: number }>(
      `SELECT approval_id
       FROM channel_outbox
       WHERE approval_id IS NOT NULL AND status = 'queued'
       ORDER BY created_at ASC, outbox_id ASC
       LIMIT 1`,
    );
    if (pending?.approval_id) {
      const approval = await this.approvalDal.getById(pending.approval_id);
      if (approval) {
        if (approval.status === "approved") {
          await this.outbox.clearApprovalById(approval.id);
          return true;
        }
        if (approval.status === "denied" || approval.status === "expired" || approval.status === "cancelled") {
          const reason = approval.response_reason ?? `approval ${approval.status}`;
          await this.outbox.markFailedByApproval(approval.id, reason);
          return true;
        }
      }
    }

    return await this.sendNextOutbox();
  }

  private async sendNextOutbox(): Promise<boolean> {
    const next = await this.outbox.claimNextGlobal({
      owner: this.owner,
      now_ms: Date.now(),
      lease_ttl_ms: this.outboxLeaseTtlMs,
    });
    if (!next) return false;

    try {
      const resp = await this.telegramBot.sendMessage(next.thread_id, next.text);
      await this.outbox.markSent(next.outbox_id, this.owner, resp);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.outbox.markFailed(next.outbox_id, this.owner, message);
      this.logger?.warn("channels.telegram.send_failed", {
        outbox_id: next.outbox_id,
        thread_id: next.thread_id,
        error: message,
      });
    }

    return true;
  }

  private async claimDebouncedBatch(leader: ChannelInboxRow): Promise<ChannelInboxRow[]> {
    if (this.debounceMs <= 0) return [leader];

    const windowStart = leader.received_at_ms;
    const windowEnd = windowStart + this.debounceMs;

    const extra = await this.inbox.listQueuedForKey({
      key: leader.key,
      lane: leader.lane,
      received_at_ms_gte: windowStart,
      received_at_ms_lte: windowEnd,
      limit: Math.max(0, this.maxBatch - 1),
    });

    const ids = extra.map((r) => r.inbox_id);
    if (ids.length > 0) {
      await this.inbox.claimBatchByIds({
        inbox_ids: ids,
        owner: this.owner,
        now_ms: Date.now(),
        lease_ttl_ms: this.inboxLeaseTtlMs,
      });
      // Re-fetch claimed rows so payload is present.
      const claimedExtra: ChannelInboxRow[] = [];
      for (const id of ids) {
        const row = await this.inbox.getById(id);
        if (row && row.status === "processing" && row.lease_owner === this.owner) {
          claimedExtra.push(row);
        }
      }
      return [leader, ...claimedExtra];
    }

    return [leader];
  }

  private async processBatch(rows: ChannelInboxRow[]): Promise<void> {
    const leader = rows[0]!;
    const messages: string[] = [];

    for (const row of rows) {
      const parsed = NormalizedThreadMessageSchema.safeParse(row.payload);
      if (!parsed.success) continue;
      const text = extractMessageText(parsed.data).trim();
      if (text.length > 0) messages.push(text);
    }

    const combined = messages.join("\n\n").trim();
    if (combined.length === 0) {
      for (const row of rows) {
        await this.inbox.markCompleted(row.inbox_id, this.owner, "");
      }
      return;
    }

    let reply: string;
    let agentId = "default";
    try {
      try {
        const parsedKey = parseTyrumKey(leader.key as never);
        if (parsedKey.kind === "agent") {
          agentId = parsedKey.agent_id;
        }
      } catch {
        // ignore invalid keys; fall back to default agent
      }

      const runtime = await this.agents.getRuntime(agentId);
      const result = await runtime.turn({
        channel: "telegram",
        thread_id: leader.thread_id,
        message: combined,
      });
      reply = result.reply ?? "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.warn("channels.telegram.agent_failed", {
        inbox_id: leader.inbox_id,
        thread_id: leader.thread_id,
        error: message,
      });
      await this.telegramBot.sendMessage(
        leader.thread_id,
        "Sorry, something went wrong. Please try again later.",
      );
      for (const row of rows) {
        await this.inbox.markFailed(row.inbox_id, this.owner, message);
      }
      return;
    }

    const chunks = renderMarkdownForTelegram(reply);
    const source = "telegram";

    // Apply outbound send policy before enqueueing side effects.
    let decision: "allow" | "deny" | "require_approval" = "allow";
    let policySnapshotId: string | undefined;
    const policyService =
      typeof (this.agents as unknown as { getPolicyService?: (id: string) => PolicyService }).getPolicyService ===
      "function"
        ? this.agents.getPolicyService(agentId)
        : undefined;
    if (policyService?.isEnabled()) {
      try {
        const evalRes = await policyService.evaluateConnectorAction({
          agentId,
          workspaceId: agentId,
          matchTarget: `${source}:${leader.thread_id}`,
        });
        decision = evalRes.decision;
        policySnapshotId = evalRes.policy_snapshot?.policy_snapshot_id;
      } catch {
        // Fail closed: require approval when policy evaluation fails.
        decision = "require_approval";
      }

      if (policyService.isObserveOnly()) {
        decision = "allow";
      } else if (decision === "deny") {
        for (const row of rows) {
          await this.inbox.markFailed(row.inbox_id, this.owner, "policy denied outbound send");
        }
        return;
      }
    }

    let approvalId: number | undefined;
    if (decision === "require_approval" && chunks.length > 0) {
      if (!this.approvalDal) {
        for (const row of rows) {
          await this.inbox.markFailed(row.inbox_id, this.owner, "approval required but approvals are unavailable");
        }
        return;
      }

      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const approval = await this.approvalDal.create({
        planId: `connector:${source}:${leader.thread_id}:${leader.message_id}`,
        stepIndex: 0,
        kind: "connector.send",
        agentId,
        workspaceId: agentId,
        key: leader.key,
        lane: leader.lane,
        prompt: `Approve sending a ${source} reply`,
        context: {
          source,
          thread_id: leader.thread_id,
          inbox_id: leader.inbox_id,
          policy_snapshot_id: policySnapshotId,
          chunks: chunks.length,
          preview: chunks.slice(0, 1)[0] ?? "",
        },
        expiresAt,
      });
      approvalId = approval.id;
      try {
        this.approvalNotifier?.notify(approval);
      } catch {
        // ignore best-effort notify failures
      }
    }

    // Durable enqueue of outbound chunks.
    for (let i = 0; i < chunks.length; i += 1) {
      const text = chunks[i]!;
      const dedupeKey = `telegram:${leader.thread_id}:${leader.message_id}:reply:${String(i)}`;
      await this.outbox.enqueue({
        inbox_id: leader.inbox_id,
        source,
        thread_id: leader.thread_id,
        dedupe_key: dedupeKey,
        chunk_index: i,
        text,
      });
    }

    if (approvalId) {
      await this.outbox.setApprovalForInbox(leader.inbox_id, approvalId);
    }

    for (const row of rows) {
      await this.inbox.markCompleted(row.inbox_id, this.owner, reply);
    }
  }
}
