import type { HarnessTranslatorSink, UiMessageChunk } from "./translation.js";

/**
 * Delivers a harness turn's translated chunks to the operator's live stream.
 *
 * The `ExecutionBackend` streaming port hands its caller something that
 * exposes `toUIMessageStream()`; the WS layer iterates that stream and emits
 * each chunk as a `chat.ui-message.stream` frame. A harness produces the chunks
 * itself rather than through the ai-sdk pipe, so this is the adapter between
 * the two: a sink on one side, a `ReadableStream` on the other.
 *
 * `ReadableStream` invokes `start` during construction, so the controller
 * exists before the first chunk can arrive and nothing needs buffering here;
 * chunks enqueued before a reader attaches sit in the stream's own queue.
 */
export class HarnessUiMessageStream {
  private controller: ReadableStreamDefaultController<UiMessageChunk> | undefined;
  private settled = false;
  readonly readable: ReadableStream<UiMessageChunk>;

  constructor() {
    this.readable = new ReadableStream<UiMessageChunk>({
      start: (controller) => {
        this.controller = controller;
      },
    });
  }

  get sink(): HarnessTranslatorSink {
    return {
      emitChunk: (chunk) => {
        if (this.settled) return;
        this.controller?.enqueue(chunk);
      },
    };
  }

  /** Ends the stream normally. Safe to call more than once. */
  close(): void {
    if (this.settled) return;
    this.settled = true;
    this.controller?.close();
  }

  /**
   * Ends the stream with an error so a subscriber learns the turn failed rather
   * than waiting on a stream that never closes.
   */
  fail(error: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.controller?.error(error);
  }
}
