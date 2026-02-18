import { describe, expect, it, vi } from "vitest";
import { TelegramBot } from "../../src/modules/ingress/telegram-bot.js";

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe("TelegramBot", () => {
  const token = "123:ABC";

  it("sendMessage calls the correct API endpoint", async () => {
    const fetchFn = mockFetch(200, { ok: true, result: {} });
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

  it("sendMessage passes parse_mode option", async () => {
    const fetchFn = mockFetch(200, { ok: true });
    const bot = new TelegramBot(token, fetchFn);

    await bot.sendMessage("42", "<b>bold</b>", { parse_mode: "HTML" });

    const [, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const parsedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(parsedBody["parse_mode"]).toBe("HTML");
  });

  it("sendInlineKeyboard includes reply_markup", async () => {
    const fetchFn = mockFetch(200, { ok: true });
    const bot = new TelegramBot(token, fetchFn);

    const buttons = [[{ text: "Approve", callback_data: "approve" }]];
    await bot.sendInlineKeyboard("42", "Confirm?", buttons);

    const [, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const parsedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(parsedBody["reply_markup"]).toEqual({
      inline_keyboard: buttons,
    });
  });

  it("setWebhook calls the correct endpoint", async () => {
    const fetchFn = mockFetch(200, { ok: true });
    const bot = new TelegramBot(token, fetchFn);

    await bot.setWebhook("https://example.com/webhook");

    const [url, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.telegram.org/bot123:ABC/setWebhook");
    const parsedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(parsedBody["url"]).toBe("https://example.com/webhook");
  });

  it("throws on non-OK response", async () => {
    const fetchFn = mockFetch(403, { ok: false, description: "Forbidden" });
    const bot = new TelegramBot(token, fetchFn);

    await expect(bot.sendMessage("42", "test")).rejects.toThrow(
      /Telegram Bot API sendMessage failed \(403\)/,
    );
  });

  it("sendMessage passes reply_to_message_id", async () => {
    const fetchFn = mockFetch(200, { ok: true });
    const bot = new TelegramBot(token, fetchFn);

    await bot.sendMessage("42", "reply", { reply_to_message_id: 99 });

    const [, opts] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const parsedBody = JSON.parse(opts.body as string) as Record<string, unknown>;
    expect(parsedBody["reply_to_message_id"]).toBe(99);
  });
});
