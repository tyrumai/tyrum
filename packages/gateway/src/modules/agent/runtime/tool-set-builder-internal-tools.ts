import { jsonSchema, tool as aiTool, zodSchema } from "ai";
import type { Tool } from "ai";
import { validateModelToolInputSchema } from "../tool-schema.js";
import {
  TurnMemoryDecisionSchema,
  recordTurnMemoryDecision,
  type TurnMemoryDecisionCollector,
} from "./turn-memory-policy.js";
import {
  getGuardianReviewDecisionSchema,
  recordGuardianReviewDecision,
  type GuardianReviewDecisionCollector,
} from "../../review/guardian-review-mode.js";
import type { z } from "zod";

export const TURN_MEMORY_DECISION_TOOL_ID = "memory_turn_decision";
export const GUARDIAN_REVIEW_DECISION_TOOL_ID = "guardian_review_decision";

export function createTurnMemoryDecisionTool(collector: TurnMemoryDecisionCollector): Tool {
  return aiTool({
    description:
      "Internal tool. Call exactly once on every normal turn to report whether this turn should be stored in memory.",
    inputSchema: createValidatedDecisionInputSchema(
      TURN_MEMORY_DECISION_TOOL_ID,
      TurnMemoryDecisionSchema,
    ),
    execute: async (args) => {
      const recorded = recordTurnMemoryDecision(collector, args);
      return JSON.stringify(
        recorded.ok ? { status: "ok" } : { status: "invalid", error: recorded.error },
      );
    },
  });
}

export function createGuardianReviewDecisionTool(collector: GuardianReviewDecisionCollector): Tool {
  return aiTool({
    description: "Internal tool. Call exactly once with the final guardian review decision.",
    inputSchema: createValidatedDecisionInputSchema(
      GUARDIAN_REVIEW_DECISION_TOOL_ID,
      getGuardianReviewDecisionSchema(collector.subjectType),
    ),
    execute: async (args) => {
      const recorded = recordGuardianReviewDecision(collector, args);
      return JSON.stringify(
        recorded.ok ? { status: "ok" } : { status: "invalid", error: recorded.error },
      );
    },
  });
}

function createValidatedDecisionInputSchema<T>(toolId: string, schema: z.ZodType<T>) {
  return jsonSchema<T>(
    async () => {
      const json = await zodSchema(schema).jsonSchema;
      const validatedSchema = validateModelToolInputSchema({ ...json, type: "object" });
      if (!validatedSchema.ok) {
        throw new Error(`invalid input schema for tool '${toolId}': ${validatedSchema.error}`);
      }
      return validatedSchema.schema;
    },
    {
      validate: async (value) => {
        const parsed = await schema.safeParseAsync(value);
        return parsed.success
          ? { success: true, value: parsed.data }
          : { success: false, error: parsed.error };
      },
    },
  );
}
