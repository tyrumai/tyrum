import { describe, expect, it, vi } from "vitest";
import {
  emitTelegramDebugLog,
  summarizeTelegramEgressContent,
} from "../../src/modules/channels/telegram-debug.js";

describe("emitTelegramDebugLog", () => {
  it("suppresses telegram debug logs when disabled", () => {
    const logger = { info: vi.fn() };

    emitTelegramDebugLog({
      logger,
      enabled: false,
      accountKey: "alerts",
      event: "received_update",
      fields: { update_id: 123 },
    });

    expect(logger.info).not.toHaveBeenCalled();
  });

  it("adds the channel debug envelope when enabled", () => {
    const logger = { info: vi.fn() };

    emitTelegramDebugLog({
      logger,
      enabled: true,
      accountKey: "alerts",
      event: "received_update",
      fields: { update_id: 123 },
    });

    expect(logger.info).toHaveBeenCalledWith(
      "channel.telegram.debug.received_update",
      expect.objectContaining({
        debug_scope: "channel",
        channel: "telegram",
        account_key: "alerts",
        update_id: 123,
      }),
    );
  });
});

describe("summarizeTelegramEgressContent", () => {
  it("logs attachment metadata without transport-only fields", () => {
    expect(
      summarizeTelegramEgressContent({
        text: "hello",
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
      }),
    ).toEqual({
      text: "hello",
      text_length: 5,
      attachment_count: 1,
      attachments: [
        {
          artifact_id: "artifact-1",
          filename: "artifact-1.png",
          mime_type: "image/png",
          media_class: "image",
          size_bytes: 14,
        },
      ],
    });
  });
});
