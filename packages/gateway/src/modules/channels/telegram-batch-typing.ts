import type { Logger } from "../observability/logger.js";

export function createTelegramBatchTypingController(input: {
  enabled: boolean;
  refreshMs: number;
  connectorId: string;
  threadId: string;
  messageId: string;
  logger?: Logger;
  sendTyping: () => Promise<void>;
}): {
  startNow: () => void;
  scheduleStart: (delayMs: number) => void;
  stop: () => void;
} {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let started = false;

  const stop = (): void => {
    started = false;
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
  };

  const trigger = (): void => {
    if (!input.enabled) return;
    void input.sendTyping().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      input.logger?.debug("channels.telegram.send_typing_failed", {
        channel_id: input.connectorId,
        message_id: input.messageId,
        thread_id: input.threadId,
        error: message,
      });
    });
  };

  const startNow = (): void => {
    if (!input.enabled || started) return;
    started = true;
    trigger();
    if (input.refreshMs > 0) {
      interval = setInterval(trigger, input.refreshMs);
    }
  };

  const scheduleStart = (delayMs: number): void => {
    if (!input.enabled || started) return;
    timeout = setTimeout(startNow, delayMs);
  };

  return { startNow, scheduleStart, stop };
}
