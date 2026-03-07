import { expect, it, vi } from "vitest";
import { normalizeUpdate } from "../../src/modules/ingress/telegram.js";
import {
  listTypingCalls,
  makeDelayedRuntime,
  makeTelegramUpdate,
  setupTelegramProcessorHarness,
  type TelegramQueueTestState,
  withFakeTimers,
} from "./telegram-queue.test-fixtures.js";

async function withTypingScenario(
  state: TelegramQueueTestState,
  options: {
    lane?: "cron";
    typingAutomationEnabled?: boolean;
    typingMode: "instant" | "message" | "thinking" | "never";
  },
  assertRun: (context: { fetchFn: typeof fetch; tickPromise: Promise<void> }) => Promise<void>,
): Promise<void> {
  const dbState = setupTelegramProcessorHarness(state, {
    processorOptions: {
      typingAutomationEnabled: options.typingAutomationEnabled,
      typingMode: options.typingMode,
      typingRefreshMs: 1,
    },
    runtime: makeDelayedRuntime(),
  });

  process.env["TYRUM_CHANNEL_TYPING_MODE"] = options.typingMode;
  process.env["TYRUM_CHANNEL_TYPING_REFRESH_MS"] = "1";
  if (options.typingAutomationEnabled) {
    process.env["TYRUM_CHANNEL_TYPING_AUTOMATION_ENABLED"] = "enabled";
  }

  await withFakeTimers(async () => {
    const normalized = normalizeUpdate(JSON.stringify(makeTelegramUpdate("Help me")));
    if (options.lane) {
      await dbState.queue.enqueue(normalized, { lane: options.lane });
    } else {
      await dbState.queue.enqueue(normalized);
    }

    const tickPromise = dbState.processor.tick();
    await assertRun({ fetchFn: dbState.fetchFn, tickPromise });
  });
}

export function registerTelegramQueueTypingTests(state: TelegramQueueTestState): void {
  it("sends typing chat actions in instant mode with bounded cadence", async () => {
    await withTypingScenario(state, { typingMode: "instant" }, async ({ fetchFn, tickPromise }) => {
      await vi.advanceTimersByTimeAsync(2_500);
      await tickPromise;

      expect(listTypingCalls(fetchFn)).toHaveLength(3);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(listTypingCalls(fetchFn)).toHaveLength(3);
    });
  });

  it("starts typing chat actions during response generation when mode is message", async () => {
    await withTypingScenario(state, { typingMode: "message" }, async ({ fetchFn, tickPromise }) => {
      await vi.advanceTimersByTimeAsync(200);
      expect(listTypingCalls(fetchFn)).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(100);
      expect(listTypingCalls(fetchFn)).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(2_200);
      await tickPromise;

      expect(listTypingCalls(fetchFn)).toHaveLength(3);
    });
  });

  it("treats thinking mode as instant typing in non-streaming channel turns", async () => {
    await withTypingScenario(
      state,
      { typingMode: "thinking" },
      async ({ fetchFn, tickPromise }) => {
        await vi.advanceTimersByTimeAsync(2_500);
        await tickPromise;

        expect(listTypingCalls(fetchFn)).toHaveLength(3);
      },
    );
  });

  it("does not send typing chat actions when mode is never", async () => {
    await withTypingScenario(state, { typingMode: "never" }, async ({ fetchFn, tickPromise }) => {
      await vi.advanceTimersByTimeAsync(2_500);
      await tickPromise;

      expect(listTypingCalls(fetchFn)).toHaveLength(0);
    });
  });

  it("disables typing indicators for automation lanes unless explicitly enabled", async () => {
    await withTypingScenario(
      state,
      { lane: "cron", typingAutomationEnabled: false, typingMode: "instant" },
      async ({ fetchFn, tickPromise }) => {
        await vi.advanceTimersByTimeAsync(2_500);
        await tickPromise;

        expect(listTypingCalls(fetchFn)).toHaveLength(0);
      },
    );
  });

  it("enables typing indicators for automation lanes when explicitly enabled", async () => {
    await withTypingScenario(
      state,
      { lane: "cron", typingAutomationEnabled: true, typingMode: "instant" },
      async ({ fetchFn, tickPromise }) => {
        await vi.advanceTimersByTimeAsync(2_500);
        await tickPromise;

        expect(listTypingCalls(fetchFn)).toHaveLength(3);
      },
    );
  });
}
