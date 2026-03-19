import { expect, it, vi } from "vitest";
import {
  createTelegramMediaFetch,
  createTestArtifactStore,
  createIngressApp,
  makeResolvedRuntime,
  makeTelegramUpdate,
  postTelegramUpdate,
  setupTelegramProcessorHarness,
  type TelegramQueueTestState,
} from "./telegram-queue.test-fixtures.js";

export function registerTelegramQueueCoreTests(state: TelegramQueueTestState): void {
  it("queues inbound updates durably and processes them via the channel processor", async () => {
    const { bot, fetchFn, processor, queue, runtime } = setupTelegramProcessorHarness(state);
    const app = createIngressApp({ bot, queue, runtime });

    const res1 = await postTelegramUpdate(app, makeTelegramUpdate("Help me"));

    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { ok: boolean; queued?: boolean; deduped?: boolean };
    expect(body1.ok).toBe(true);
    expect(body1.queued).toBe(true);
    expect(body1.deduped).toBe(false);

    expect(runtime.turn).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();

    await processor.tick();

    expect(runtime.turn).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          delivery: { channel: "telegram", account: "default" },
          container: { kind: "dm", id: "123" },
          sender: expect.objectContaining({ id: "999" }),
          content: { text: "Help me", attachments: [] },
          provenance: ["user"],
        }),
      }),
    );
    expect(fetchFn).toHaveBeenCalledOnce();
    const [, sendOptions] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const sendBody = JSON.parse(sendOptions.body as string) as Record<string, unknown>;
    expect(sendBody["parse_mode"]).toBe("HTML");

    const res2 = await postTelegramUpdate(app, makeTelegramUpdate("Help me"));

    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { ok: boolean; queued?: boolean; deduped?: boolean };
    expect(body2.ok).toBe(true);
    expect(body2.deduped).toBe(true);

    await processor.tick();
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("processes attachment-only messages by passing the normalized envelope through", async () => {
    const artifactStore = createTestArtifactStore();
    const { bot, processor, queue, runtime } = setupTelegramProcessorHarness(state, {
      fetchFn: createTelegramMediaFetch(),
      runtime: makeResolvedRuntime("Got it."),
    });
    const app = createIngressApp({ bot, queue, runtime, artifactStore });

    const res = await postTelegramUpdate(app, {
      update_id: 100,
      message: {
        message_id: 43,
        date: 1700000000,
        from: { id: 999, is_bot: false, first_name: "Alice" },
        chat: { id: 123, type: "private" },
        caption: "  ",
        photo: [{ file_id: "abc" }],
      },
    });

    expect(res.status).toBe(200);

    await processor.tick();

    expect(runtime.turn).toHaveBeenCalledWith(
      expect.objectContaining({
        envelope: expect.objectContaining({
          container: { kind: "dm", id: "123" },
          content: expect.objectContaining({
            text: undefined,
            attachments: [
              expect.objectContaining({
                media_class: "image",
                external_url: "https://gateway.example/a/11111111-1111-4111-8111-111111111111",
              }),
            ],
          }),
          provenance: ["user"],
        }),
      }),
    );
  });
}
