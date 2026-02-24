import { DEFAULT_CHANNEL_ACCOUNT_ID } from "./interface.js";

type Env = Record<string, string | undefined>;

export function telegramAccountIdFromEnv(env: Env = process.env): string {
  return env["TYRUM_TELEGRAM_ACCOUNT_ID"]?.trim()
    || env["TYRUM_TELEGRAM_CHANNEL_KEY"]?.trim()
    || DEFAULT_CHANNEL_ACCOUNT_ID;
}
