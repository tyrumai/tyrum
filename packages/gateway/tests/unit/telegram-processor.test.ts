import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedThreadMessage } from "@tyrum/contracts";
import { SessionDal } from "../../src/modules/agent/session-dal.js";
import type { AgentRegistry } from "../../src/modules/agent/registry.js";
import { ChannelInboxDal } from "../../src/modules/channels/inbox-dal.js";
import { ChannelOutboxDal } from "../../src/modules/channels/outbox-dal.js";
import { TelegramChannelProcessor } from "../../src/modules/channels/telegram.js";
import { ChannelThreadDal } from "../../src/modules/channels/thread-dal.js";
import { IdentityScopeDal } from "../../src/modules/identity/scope.js";
import type { SqliteDb } from "../../src/statestore/sqlite.js";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";
import { TELEGRAM_CAPTION_MAX_LENGTH } from "../../src/modules/channels/telegram-shared.js";
import { openTestSqliteDb } from "../helpers/sqlite-db.js";

function makeNormalizedTextMessage(input: {
  threadId: string;
  messageId: string;
  text: string;
}): NormalizedThreadMessage {
  const nowIso = new Date().toISOString();
  return {
    thread: {
      id: input.threadId,
      kind: "private",
      title: undefined,
      username: undefined,
      pii_fields: [],
    },
    message: {
      id: input.messageId,
      thread_id: input.threadId,
      source: "telegram",
      content: { text: input.text, attachments: [] },
      sender: {
        id: "peer-1",
        is_bot: false,
        username: "peer",
      },
      timestamp: nowIso,
      edited_timestamp: undefined,
      pii_fields: ["message_text"],
      envelope: {
        message_id: input.messageId,
        received_at: nowIso,
        delivery: { channel: "telegram", account: "work" },
        container: { kind: "dm", id: input.threadId },
        sender: { id: "peer-1", display: "peer" },
        content: { text: input.text, attachments: [] },
        provenance: ["user"],
      },
    },
  };
}

describe("TelegramChannelProcessor", () => {
  let db: SqliteDb;
  let didOpenDb = false;

  beforeEach(() => {
    didOpenDb = false;
    db = openTestSqliteDb();
    didOpenDb = true;
  });

  afterEach(async () => {
    if (!didOpenDb) return;
    didOpenDb = false;
    await db.close();
  });

  it("loads dynamic egress connectors once per tenant within a tick", async () => {
    const sessionDal = new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
    const inbox = new ChannelInboxDal(db, sessionDal);
    const outbox = new ChannelOutboxDal(db);

    for (const messageId of ["msg-1", "msg-2"]) {
      const { row } = await inbox.enqueue({
        source: "telegram:work",
        thread_id: "chat-1",
        message_id: messageId,
        key: "agent:default:telegram:work:dm:chat-1",
        lane: "main",
        received_at_ms: Date.now(),
        payload: makeNormalizedTextMessage({
          threadId: "chat-1",
          messageId,
          text: `hello ${messageId}`,
        }),
      });

      await db.run(
        `UPDATE channel_inbox
         SET status = 'completed',
             lease_owner = NULL,
             lease_expires_at_ms = NULL,
             processed_at = datetime('now'),
             error = NULL,
             reply_text = ''
         WHERE inbox_id = ?`,
        [row.inbox_id],
      );

      await outbox.enqueue({
        tenant_id: row.tenant_id,
        inbox_id: row.inbox_id,
        source: "telegram:work",
        thread_id: "chat-1",
        dedupe_key: `dedupe-${messageId}`,
        chunk_index: 0,
        text: `reply ${messageId}`,
        workspace_id: row.workspace_id,
        session_id: row.session_id,
        channel_thread_id: row.channel_thread_id,
      });
    }

    const sendMessage = vi.fn(async () => ({ ok: true }));
    const listEgressConnectors = vi.fn(async () => [
      { connector: "telegram", accountId: "work", sendMessage },
    ]);
    const agents: AgentRegistry = { getRuntime: vi.fn() } as unknown as AgentRegistry;

    const processor = new TelegramChannelProcessor({
      db,
      sessionDal,
      agents,
      owner: "worker-1",
      listEgressConnectors,
      debounceMs: 0,
      maxBatch: 1,
    });

    await processor.tick();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(listEgressConnectors).toHaveBeenCalledTimes(1);
    expect(listEgressConnectors).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
  });

  it("delivers queued artifact attachments as Telegram media uploads", async () => {
    const sessionDal = new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
    const inbox = new ChannelInboxDal(db, sessionDal);
    const outbox = new ChannelOutboxDal(db);

    const { row } = await inbox.enqueue({
      source: "telegram:work",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: "agent:default:telegram:work:dm:chat-1",
      lane: "main",
      received_at_ms: Date.now(),
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-1",
        text: "hello",
      }),
    });

    await db.run(
      `UPDATE channel_inbox
       SET status = 'completed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           processed_at = datetime('now'),
           error = NULL,
           reply_text = ''
       WHERE inbox_id = ?`,
      [row.inbox_id],
    );

    await outbox.enqueue({
      tenant_id: row.tenant_id,
      inbox_id: row.inbox_id,
      source: "telegram:work",
      thread_id: "chat-1",
      dedupe_key: "dedupe-attachment",
      chunk_index: 0,
      text: "Here is the screenshot.",
      parse_mode: "HTML",
      attachments: [
        {
          artifact_id: "artifact-1",
          uri: "artifact://artifact-1",
          external_url: "https://cdn.example/artifact-1.png",
          kind: "file",
          media_class: "image",
          created_at: "2024-03-09T16:00:00.000Z",
          filename: "artifact-1.png",
          mime_type: "image/png",
          size_bytes: 14,
          sha256: "a".repeat(64),
          labels: [],
        },
      ],
      workspace_id: row.workspace_id,
      session_id: row.session_id,
      channel_thread_id: row.channel_thread_id,
    });

    const botFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const downloadFetch = vi.fn(async (url: string) => {
      expect(url).toBe("https://cdn.example/artifact-1.png");
      return new Response(Buffer.from("artifact-bytes"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", downloadFetch);
    try {
      const telegramBot = new TelegramBot("test-token", botFetch);
      const agents: AgentRegistry = { getRuntime: vi.fn() } as unknown as AgentRegistry;
      const processor = new TelegramChannelProcessor({
        db,
        sessionDal,
        agents,
        telegramBot,
        owner: "worker-1",
        debounceMs: 0,
        maxBatch: 1,
      });

      await processor.tick();

      expect(downloadFetch).toHaveBeenCalledOnce();
      expect(botFetch).toHaveBeenCalledOnce();
      const [url, opts] = (botFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toContain("/sendPhoto");
      const form = opts.body as FormData;
      expect(form.get("caption")).toBe("Here is the screenshot.");
      expect(form.get("photo")).toBeInstanceOf(Blob);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends follow-up text separately when an attachment caption would exceed Telegram limits", async () => {
    const sessionDal = new SessionDal(db, new IdentityScopeDal(db), new ChannelThreadDal(db));
    const inbox = new ChannelInboxDal(db, sessionDal);
    const outbox = new ChannelOutboxDal(db);

    const { row } = await inbox.enqueue({
      source: "telegram:work",
      thread_id: "chat-1",
      message_id: "msg-1",
      key: "agent:default:telegram:work:dm:chat-1",
      lane: "main",
      received_at_ms: Date.now(),
      payload: makeNormalizedTextMessage({
        threadId: "chat-1",
        messageId: "msg-1",
        text: "hello",
      }),
    });

    await db.run(
      `UPDATE channel_inbox
       SET status = 'completed',
           lease_owner = NULL,
           lease_expires_at_ms = NULL,
           processed_at = datetime('now'),
           error = NULL,
           reply_text = ''
       WHERE inbox_id = ?`,
      [row.inbox_id],
    );

    const followUpText = "x".repeat(TELEGRAM_CAPTION_MAX_LENGTH + 1);
    await outbox.enqueue({
      tenant_id: row.tenant_id,
      inbox_id: row.inbox_id,
      source: "telegram:work",
      thread_id: "chat-1",
      dedupe_key: "dedupe-followup",
      chunk_index: 0,
      text: followUpText,
      parse_mode: "HTML",
      attachments: [
        {
          artifact_id: "artifact-1",
          uri: "artifact://artifact-1",
          external_url: "https://cdn.example/artifact-1.png",
          kind: "file",
          media_class: "image",
          created_at: "2024-03-09T16:00:00.000Z",
          filename: "artifact-1.png",
          mime_type: "image/png",
          size_bytes: 14,
          sha256: "a".repeat(64),
          labels: [],
        },
      ],
      workspace_id: row.workspace_id,
      session_id: row.session_id,
      channel_thread_id: row.channel_thread_id,
    });

    const botFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 7 } }),
      text: async () => '{"ok":true}',
    })) as unknown as typeof fetch;
    const downloadFetch = vi.fn(async (url: string) => {
      expect(url).toBe("https://cdn.example/artifact-1.png");
      return new Response(Buffer.from("artifact-bytes"), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof fetch;

    vi.stubGlobal("fetch", downloadFetch);
    try {
      const telegramBot = new TelegramBot("test-token", botFetch);
      const agents: AgentRegistry = { getRuntime: vi.fn() } as unknown as AgentRegistry;
      const processor = new TelegramChannelProcessor({
        db,
        sessionDal,
        agents,
        telegramBot,
        owner: "worker-1",
        debounceMs: 0,
        maxBatch: 1,
      });

      await processor.tick();

      expect(downloadFetch).toHaveBeenCalledOnce();
      expect(botFetch).toHaveBeenCalledTimes(2);

      const [photoUrl, photoOpts] = (botFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(photoUrl).toContain("/sendPhoto");
      const photoForm = photoOpts.body as FormData;
      expect(photoForm.get("caption")).toBeNull();
      expect(photoForm.get("photo")).toBeInstanceOf(Blob);

      const [messageUrl, messageOpts] = (botFetch as ReturnType<typeof vi.fn>).mock.calls[1] as [
        string,
        RequestInit,
      ];
      expect(messageUrl).toContain("/sendMessage");
      const messageBody = JSON.parse(messageOpts.body as string) as Record<string, unknown>;
      expect(messageBody["text"]).toBe(followUpText);
      expect(messageBody["parse_mode"]).toBe("HTML");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
