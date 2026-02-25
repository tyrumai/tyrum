/**
 * Telegram Bot API wrapper.
 *
 * Wraps Bot API calls via fetch — no external dependencies.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SendMessageOptions {
  parse_mode?: "HTML" | "Markdown" | "MarkdownV2";
  disable_notification?: boolean;
  reply_to_message_id?: number;
}

export type TelegramChatAction = "typing";

export class TelegramBot {
  private readonly apiBase: string;

  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.apiBase = `${TELEGRAM_API_BASE}/bot${this.token}`;
  }

  /** Send a plain text message to a chat. */
  async sendMessage(
    chatId: string | number,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
    };
    if (opts?.parse_mode) body["parse_mode"] = opts.parse_mode;
    if (opts?.disable_notification) body["disable_notification"] = true;
    if (opts?.reply_to_message_id) {
      body["reply_to_message_id"] = opts.reply_to_message_id;
    }

    return this.call("sendMessage", body);
  }

  /** Send a message with an inline keyboard. */
  async sendInlineKeyboard(
    chatId: string | number,
    text: string,
    buttons: InlineKeyboardButton[][],
    opts?: SendMessageOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: buttons,
      },
    };
    if (opts?.parse_mode) body["parse_mode"] = opts.parse_mode;

    return this.call("sendMessage", body);
  }

  /** Register a webhook URL with Telegram. */
  async setWebhook(url: string): Promise<unknown> {
    return this.call("setWebhook", { url });
  }

  /** Send a chat action (for example typing) to a chat. */
  async sendChatAction(chatId: string | number, action: TelegramChatAction): Promise<unknown> {
    return this.call("sendChatAction", { chat_id: chatId, action });
  }

  private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBase}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Telegram Bot API ${method} failed (${String(response.status)}): ${text}`);
    }

    return response.json() as Promise<unknown>;
  }
}
