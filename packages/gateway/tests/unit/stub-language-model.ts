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

export function createMemoryDecisionLanguageModel(input: {
  decision: Record<string, unknown>;
  reply: string;
}): MockLanguageModelV3 {
  let callCount = 0;

  return new MockLanguageModelV3({
    doGenerate: async () => {
      callCount += 1;
      if (callCount === 1) {
        const shouldStore = input.decision["should_store"] === true;
        const memory =
          shouldStore &&
          input.decision["memory"] &&
          typeof input.decision["memory"] === "object" &&
          !Array.isArray(input.decision["memory"])
            ? input.decision["memory"]
            : undefined;
        return {
          content:
            shouldStore && memory
              ? [
                  {
                    type: "tool-call" as const,
                    toolCallId: "tc-memory-write",
                    toolName: "mcp.memory.write",
                    input: JSON.stringify(memory),
                  },
                ]
              : [{ type: "text" as const, text: input.reply }],
          finishReason: {
            unified: shouldStore && memory ? ("tool-calls" as const) : ("stop" as const),
            raw: undefined,
          },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        };
      }

      return {
        content: [{ type: "text" as const, text: input.reply }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

export function createGuardianDecisionLanguageModel(input: {
  decision: Record<string, unknown>;
  reply?: string;
}): MockLanguageModelV3 {
  let callCount = 0;

  return new MockLanguageModelV3({
    doGenerate: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "tc-guardian-review",
              toolName: "guardian_review_decision",
              input: JSON.stringify(input.decision),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: undefined },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          },
          warnings: [],
        };
      }

      return {
        content: [{ type: "text" as const, text: input.reply ?? "" }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
