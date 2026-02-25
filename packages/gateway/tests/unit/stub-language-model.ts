import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";

/**
 * Creates a mock LanguageModel that returns a fixed reply.
 * Works with both streamText() and generateText().
 */
export function createStubLanguageModel(reply: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "text-start" as const, id: "text-1" },
          { type: "text-delta" as const, id: "text-1", delta: reply },
          { type: "text-end" as const, id: "text-1" },
          {
            type: "finish" as const,
            finishReason: { unified: "stop" as const, raw: undefined },
            logprobs: undefined,
            usage: {
              inputTokens: {
                total: 10,
                noCache: 10,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: {
                total: 5,
                text: 5,
                reasoning: undefined,
              },
            },
          },
        ],
      }),
    }),
    doGenerate: async () => ({
      content: [{ type: "text" as const, text: reply }],
      finishReason: { unified: "stop" as const, raw: undefined },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: {
          total: 5,
          text: 5,
          reasoning: undefined,
        },
      },
      warnings: [],
    }),
  });
}
