import { afterEach, beforeEach, describe } from "vitest";
import {
  captureTelegramQueueEnv,
  restoreTelegramQueueEnv,
  type TelegramQueueTestState,
  resetTelegramQueueEnv,
} from "./telegram-queue.test-fixtures.js";
import { registerTelegramQueueAccountTests } from "./telegram-queue.account-test-support.js";
import { registerTelegramQueueCoreTests } from "./telegram-queue.core-test-support.js";
import { registerTelegramQueueDeliveryReceiptTests } from "./telegram-queue.delivery-test-support.js";
import { registerTelegramQueuePolicyTests } from "./telegram-queue.policy-test-support.js";
import { registerTelegramQueueTypingTests } from "./telegram-queue.typing-test-support.js";

describe("Telegram channel pipeline: enqueue -> process -> reply", () => {
  const originalEnv = captureTelegramQueueEnv();
  const state: TelegramQueueTestState = { db: undefined };

  beforeEach(() => {
    resetTelegramQueueEnv();
  });

  afterEach(async () => {
    await state.db?.close();
    state.db = undefined;
    restoreTelegramQueueEnv(originalEnv);
  });

  registerTelegramQueueCoreTests(state);
  registerTelegramQueueTypingTests(state);
  registerTelegramQueueAccountTests(state);
  registerTelegramQueuePolicyTests(state);
  registerTelegramQueueDeliveryReceiptTests(state);
});
