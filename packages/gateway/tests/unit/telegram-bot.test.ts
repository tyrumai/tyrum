import { describe, expect, it, vi } from "vitest";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function binaryResponse(status: number, body: Uint8Array, contentType: string): Response {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

function mockJsonFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => jsonResponse(status, body)) as unknown as typeof fetch;
}

describe("TelegramBot", () => {
  const token = "123:ABC";

  it("sendMessage calls the correct API endpoint", async () => {
    const fetchFn = mockJsonFetch(200, { ok: true, result: {} });
    const bot = new TelegramBot(token, fetchFn);

    await bot.sendMessage("42", "Hello");

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.telegram.org/bot123:ABC/sendMessage");
    expect(opts.method).toBe("POST");
    const parsedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(parsedBody["chat_id"]).toBe("42");
    expect(parsedBody["text"]).toBe("Hello");
  });

  it("sendMessage passes parse_mode and reply_to_message_id", async () => {
    const fetchFn = mockJsonFetch(200, { ok: true });
    const bot = new TelegramBot(token, fetchFn);

    await bot.sendMessage("42", "<b>bold</b>", {
      parse_mode: "HTML",
      reply_to_message_id: 99,
    });

    const [, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(parsedBody["parse_mode"]).toBe("HTML");
    expect(parsedBody["reply_to_message_id"]).toBe(99);
  });

  it("sendPhoto uploads a multipart file with caption metadata", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, { ok: true, result: {} }),
    ) as unknown as typeof fetch;
    const bot = new TelegramBot(token, fetchFn);

    await bot.sendPhoto(
      "42",
      {
        bytes: Buffer.from("image-bytes"),
        filename: "photo.jpg",
        mimeType: "image/jpeg",
      },
      { caption: "Look", parse_mode: "HTML" },
    );

    const [url, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.telegram.org/bot123:ABC/sendPhoto");
    const form = opts.body as FormData;
    expect(form.get("chat_id")).toBe("42");
    expect(form.get("caption")).toBe("Look");
    expect(form.get("parse_mode")).toBe("HTML");
    const photo = form.get("photo");
    expect(photo).toBeInstanceOf(Blob);
    expect((photo as File).name).toBe("photo.jpg");
  });

  it("sendDocument, sendAudio, sendVideo, and sendVoice use multipart upload endpoints", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, { ok: true, result: {} }),
    ) as unknown as typeof fetch;
    const bot = new TelegramBot(token, fetchFn);

    await bot.sendDocument("42", {
      bytes: Buffer.from("doc"),
      filename: "doc.pdf",
      mimeType: "application/pdf",
    });
    await bot.sendAudio("42", {
      bytes: Buffer.from("audio"),
      filename: "clip.ogg",
      mimeType: "audio/ogg",
    });
    await bot.sendVideo("42", {
      bytes: Buffer.from("video"),
      filename: "clip.mp4",
      mimeType: "video/mp4",
    });
    await bot.sendVoice("42", {
      bytes: Buffer.from("voice"),
      filename: "voice.ogg",
      mimeType: "audio/ogg",
    });

    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(4);
    expect(calls.map(([url]) => String(url))).toEqual([
      "https://api.telegram.org/bot123:ABC/sendDocument",
      "https://api.telegram.org/bot123:ABC/sendAudio",
      "https://api.telegram.org/bot123:ABC/sendVideo",
      "https://api.telegram.org/bot123:ABC/sendVoice",
    ]);
  });

  it("getFile resolves the file path and downloadFileById returns bytes", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.endsWith("/getFile")) {
        return jsonResponse(200, {
          ok: true,
          result: {
            file_id: "file-1",
            file_path: "photos/file-1.jpg",
            file_size: 11,
          },
        });
      }
      return binaryResponse(200, Buffer.from("downloaded-bytes"), "image/jpeg");
    }) as unknown as typeof fetch;
    const bot = new TelegramBot(token, fetchFn);

    const file = await bot.getFile("file-1");
    expect(file).toEqual({
      file_id: "file-1",
      file_path: "photos/file-1.jpg",
      file_size: 11,
    });

    const downloaded = await bot.downloadFileById("file-1");
    expect(downloaded.body.toString("utf8")).toBe("downloaded-bytes");
    expect(downloaded.mediaType).toBe("image/jpeg");
  });

  it("downloadFilePath throws on non-OK response", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(404, { ok: false, description: "missing" }),
    ) as unknown as typeof fetch;
    const bot = new TelegramBot(token, fetchFn);

    await expect(bot.downloadFilePath("missing.bin")).rejects.toThrow(
      /Telegram Bot file download failed \(404\)/,
    );
  });

  it("throws on non-OK response", async () => {
    const fetchFn = mockJsonFetch(403, { ok: false, description: "Forbidden" });
    const bot = new TelegramBot(token, fetchFn);

    await expect(bot.sendMessage("42", "test")).rejects.toThrow(
      /Telegram Bot API sendMessage failed \(403\)/,
    );
  });
});
