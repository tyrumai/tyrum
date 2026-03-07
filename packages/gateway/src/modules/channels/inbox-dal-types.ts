export type ChannelInboxStatus = "queued" | "processing" | "completed" | "failed";

export type ChannelInboundQueueOverflowPolicy = "drop_oldest" | "drop_newest" | "summarize_dropped";

export type ChannelInboxConfig = {
  inboundDedupeTtlMs?: number;
  inboundQueueCap?: number;
  inboundQueueOverflowPolicy?: ChannelInboundQueueOverflowPolicy;
};

export type ChannelInboundQueueOverflowResult = {
  cap: number;
  policy: ChannelInboundQueueOverflowPolicy;
  queued_before: number;
  queued_after: number;
  dropped: Array<{
    inbox_id: number;
    thread_id: string;
    message_id: string;
    received_at_ms: number;
  }>;
  summary?: { inbox_id: number; message_id: string };
};

export interface ChannelInboxRow {
  inbox_id: number;
  tenant_id: string;
  source: string;
  thread_id: string;
  message_id: string;
  key: string;
  lane: string;
  queue_mode: string;
  received_at_ms: number;
  payload: unknown;
  status: ChannelInboxStatus;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  processed_at: string | null;
  error: string | null;
  reply_text: string | null;
  workspace_id: string;
  session_id: string;
  channel_thread_id: string;
}

export interface RawChannelInboxRow {
  inbox_id: number;
  tenant_id: string;
  source: string;
  thread_id: string;
  message_id: string;
  key: string;
  lane: string;
  queue_mode: string;
  received_at_ms: number;
  payload_json: string;
  status: string;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at_ms: number | null;
  processed_at: string | Date | null;
  error: string | null;
  reply_text: string | null;
  workspace_id: string;
  session_id: string;
  channel_thread_id: string;
}

export interface RawChannelInboundDedupeRow {
  tenant_id: string;
  channel: string;
  account_id: string;
  container_id: string;
  message_id: string;
  inbox_id: number | null;
  expires_at_ms: number;
}

export type RawQueuedInboxRow = {
  inbox_id: number;
  source: string;
  thread_id: string;
  message_id: string;
  received_at_ms: number;
  payload_json: string;
};
