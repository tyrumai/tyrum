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
  caption?: string;
}

export type TelegramChatAction = "typing";

export type TelegramUploadedFile = {
  bytes: Uint8Array;
  filename?: string;
  mimeType?: string;
};

type TelegramFileResponse = {
  file_id: string;
  file_path: string;
  file_size?: number;
};

export interface TelegramBotUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramGetUpdatesOptions {
  offset?: number;
  limit?: number;
  timeout?: number;
  allowed_updates?: string[];
  signal?: AbortSignal;
}

export interface TelegramUpdate {
  update_id: number;
  message?: unknown;
  edited_message?: unknown;
}

interface TelegramApiResponse<TResult> {
  ok?: boolean;
  result?: TResult;
  description?: string;
}

function applySendOptions(
  target: FormData | Record<string, unknown>,
  opts?: SendMessageOptions,
): void {
  if (!opts) {
    return;
  }
  if ("parse_mode" in opts && opts.parse_mode) {
    if (target instanceof FormData) {
      target.set("parse_mode", opts.parse_mode);
    } else {
      target["parse_mode"] = opts.parse_mode;
    }
  }
  if (opts.disable_notification) {
    if (target instanceof FormData) {
      target.set("disable_notification", "true");
    } else {
      target["disable_notification"] = true;
    }
  }
  if (typeof opts.reply_to_message_id === "number") {
    if (target instanceof FormData) {
      target.set("reply_to_message_id", String(opts.reply_to_message_id));
    } else {
      target["reply_to_message_id"] = opts.reply_to_message_id;
    }
  }
  if (opts.caption) {
    if (target instanceof FormData) {
      target.set("caption", opts.caption);
    } else {
      target["caption"] = opts.caption;
    }
  }
}

export class TelegramBot {
  private readonly apiBase: string;
  private readonly fileBase: string;

  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.apiBase = `${TELEGRAM_API_BASE}/bot${this.token}`;
    this.fileBase = `${TELEGRAM_API_BASE}/file/bot${this.token}`;
  }

  async sendMessage(
    chatId: string | number,
    text: string,
    opts?: SendMessageOptions,
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
    };
    applySendOptions(body, opts);
    return await this.callEnvelope("sendMessage", body);
  }

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
    applySendOptions(body, opts);
    return await this.callEnvelope("sendMessage", body);
  }

  async sendPhoto(
    chatId: string | number,
    file: TelegramUploadedFile,
    opts?: SendMessageOptions,
  ): Promise<unknown> {
    return await this.sendMultipart("sendPhoto", "photo", chatId, file, opts);
  }

  async sendDocument(
    chatId: string | number,
    file: TelegramUploadedFile,
    opts?: SendMessageOptions,
  ): Promise<unknown> {
    return await this.sendMultipart("sendDocument", "document", chatId, file, opts);
  }

  async sendAudio(
    chatId: string | number,
    file: TelegramUploadedFile,
    opts?: SendMessageOptions,
  ): Promise<unknown> {
    return await this.sendMultipart("sendAudio", "audio", chatId, file, opts);
  }

  async sendVideo(
    chatId: string | number,
    file: TelegramUploadedFile,
    opts?: SendMessageOptions,
  ): Promise<unknown> {
    return await this.sendMultipart("sendVideo", "video", chatId, file, opts);
  }

  async sendVoice(
    chatId: string | number,
    file: TelegramUploadedFile,
    opts?: SendMessageOptions,
  ): Promise<unknown> {
    return await this.sendMultipart("sendVoice", "voice", chatId, file, opts);
  }

  async setWebhook(url: string): Promise<unknown> {
    return await this.callEnvelope("setWebhook", { url });
  }

  /** Remove the current webhook so long polling can resume. */
  async deleteWebhook(opts?: { drop_pending_updates?: boolean }): Promise<unknown> {
    const body = opts?.drop_pending_updates === true ? { drop_pending_updates: true } : {};
    return await this.callEnvelope("deleteWebhook", body);
  }

  /** Return basic bot identity metadata for token/account validation. */
  async getMe(): Promise<TelegramBotUser> {
    return await this.callResult("getMe", {});
  }

  /** Read updates using Telegram long polling. */
  async getUpdates(opts: TelegramGetUpdatesOptions = {}): Promise<TelegramUpdate[]> {
    return await this.callResult(
      "getUpdates",
      {
        ...(typeof opts.offset === "number" ? { offset: opts.offset } : {}),
        ...(typeof opts.limit === "number" ? { limit: opts.limit } : {}),
        ...(typeof opts.timeout === "number" ? { timeout: opts.timeout } : {}),
        ...(opts.allowed_updates ? { allowed_updates: opts.allowed_updates } : {}),
      },
      { signal: opts.signal },
    );
  }

  /** Send a chat action (for example typing) to a chat. */
  async sendChatAction(chatId: string | number, action: TelegramChatAction): Promise<unknown> {
    return await this.callEnvelope("sendChatAction", { chat_id: chatId, action });
  }

  async getFile(fileId: string): Promise<TelegramFileResponse> {
    const result = await this.callResult<TelegramFileResponse>("getFile", { file_id: fileId });
    const filePath = result.file_path.trim();
    if (!filePath) {
      throw new Error(`Telegram Bot API getFile returned no file_path for file '${fileId}'`);
    }
    return {
      file_id: result.file_id.trim() || fileId,
      file_path: filePath,
      file_size: result.file_size,
    };
  }

  async downloadFileById(fileId: string): Promise<{ body: Buffer; mediaType?: string }> {
    const file = await this.getFile(fileId);
    return await this.downloadFilePath(file.file_path);
  }

  async downloadFilePath(filePath: string): Promise<{ body: Buffer; mediaType?: string }> {
    const response = await this.fetchImpl(`${this.fileBase}/${filePath}`, {
      method: "GET",
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Telegram Bot file download failed (${String(response.status)}): ${text || filePath}`,
      );
    }

    return {
      body: Buffer.from(await response.arrayBuffer()),
      mediaType: response.headers.get("content-type") ?? undefined,
    };
  }

  private async sendMultipart(
    method: string,
    fieldName: string,
    chatId: string | number,
    file: TelegramUploadedFile,
    opts?: SendMessageOptions,
  ): Promise<unknown> {
    const form = new FormData();
    form.set("chat_id", String(chatId));
    applySendOptions(form, opts);
    const blobBytes = new Uint8Array(file.bytes.byteLength);
    blobBytes.set(file.bytes);
    form.set(
      fieldName,
      new Blob([blobBytes], {
        type: file.mimeType ?? "application/octet-stream",
      }),
      file.filename ?? `${fieldName}.bin`,
    );
    return await this.callFormEnvelope(method, form);
  }

  private async callEnvelope<TResult = unknown>(
    method: string,
    body: Record<string, unknown>,
    opts?: { signal?: AbortSignal },
  ): Promise<TelegramApiResponse<TResult>> {
    const response = await this.fetchImpl(`${this.apiBase}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: opts?.signal,
    });
    return await this.parseResponse(method, response);
  }

  private async callFormEnvelope<TResult = unknown>(
    method: string,
    form: FormData,
  ): Promise<TelegramApiResponse<TResult>> {
    const response = await this.fetchImpl(`${this.apiBase}/${method}`, {
      method: "POST",
      body: form,
    });
    return await this.parseResponse(method, response);
  }

  private async callResult<TResult>(
    method: string,
    body: Record<string, unknown>,
    opts?: { signal?: AbortSignal },
  ): Promise<TResult> {
    const parsed = await this.callEnvelope<TResult>(method, body, opts);
    return parsed.result as TResult;
  }

  private async parseResponse<TResult>(
    method: string,
    response: Response,
  ): Promise<TelegramApiResponse<TResult>> {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Telegram Bot API ${method} failed (${String(response.status)}): ${text}`);
    }

    const parsed = (await response.json()) as TelegramApiResponse<TResult>;
    if (!parsed.ok) {
      throw new Error(
        `Telegram Bot API ${method} failed: ${parsed.description?.trim() || "unknown error"}`,
      );
    }
    return parsed;
  }
}
