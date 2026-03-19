import type {
  ActionPrimitive as ActionPrimitiveT,
  AgentTurnRequest as AgentTurnRequestT,
  AttemptCost as AttemptCostT,
} from "@tyrum/contracts";
import { AgentTurnRequest } from "@tyrum/contracts";
import type { GatewayContainer } from "../../container.js";
import type { StepExecutionContext, StepExecutor, StepResult } from "./engine.js";
import {
  parsePlaybookOutputContract,
  resolveMaxOutputBytes,
  validateJsonAgainstSchema,
} from "./playbook-output-contract.js";
import {
  appendToolApprovalResponseMessage,
  countAssistantMessages,
} from "../ai-sdk/message-utils.js";
import { generateText, stepCountIs } from "ai";
import type { LanguageModel, ModelMessage } from "ai";
import { isApprovalBlockedStatus } from "../approval/dal.js";
import type { SecretProvider } from "../secret/provider.js";
import { coerceRecord } from "../util/coerce.js";
import {
  DEFAULT_TOOL_APPROVAL_WAIT_MS,
  SUPPORTED_LLM_TOOL_IDS,
  maybeTruncateText,
  extractToolErrorMessage,
  type ToolBudgetState,
  type ToolCallPolicyState,
} from "./gateway-step-executor-types.js";
import {
  extractToolApprovalResumeState,
  resolveLanguageModel,
} from "./gateway-step-executor-helpers.js";
import { buildToolSet } from "./gateway-step-executor-tool-set.js";

function stringifyOutputSchema(schema: unknown): string | undefined {
  if (schema === undefined) {
    return undefined;
  }

  try {
    return JSON.stringify(schema, null, 2);
  } catch {
    return undefined;
  }
}

function formatOutputContractPrompt(outputContract: { schema?: unknown }): string {
  const lines = [
    "Output contract:",
    "- Return exactly one valid JSON value that satisfies the declared contract.",
    "- Do not return prose, Markdown fences, commentary, or wrapper text.",
    "- Do not invent unsupported facts. If evidence is limited, keep the JSON conservative.",
  ];
  const schemaText = stringifyOutputSchema(outputContract.schema);
  if (schemaText) {
    lines.push("Schema:");
    lines.push(schemaText);
  }
  return lines.join("\n");
}

async function executeLlmAction(input: {
  action: ActionPrimitiveT;
  planId: string;
  stepIndex: number;
  timeoutMs: number;
  container: GatewayContainer;
  toolExecutor: StepExecutor;
  executionContext: StepExecutionContext;
  secretProvider?: SecretProvider;
  languageModelOverride?: LanguageModel;
}): Promise<StepResult> {
  const startedAt = Date.now();

  const args = coerceRecord(input.action.args) ?? {};
  const modelIdRaw = typeof args["model"] === "string" ? args["model"].trim() : "";
  const prompt = typeof args["prompt"] === "string" ? args["prompt"] : "";
  const maxToolCallsRaw = args["max_tool_calls"];
  const maxToolCalls =
    typeof maxToolCallsRaw === "number" && Number.isFinite(maxToolCallsRaw) && maxToolCallsRaw >= 0
      ? Math.floor(maxToolCallsRaw)
      : 0;

  const toolsObj = coerceRecord(args["tools"]);
  const rawAllowedToolIds = toolsObj?.["allow"];
  const allowedToolIds = Array.isArray(rawAllowedToolIds)
    ? rawAllowedToolIds.filter((v): v is string => typeof v === "string")
    : [];

  const outputContract = parsePlaybookOutputContract(args);
  if (!outputContract || outputContract.kind !== "json") {
    return {
      success: false,
      error: "Output contract violated: llm steps must declare JSON output",
    };
  }

  if (!modelIdRaw) {
    return { success: false, error: "missing required argument: model" };
  }
  if (!prompt.trim()) {
    return { success: false, error: "missing required argument: prompt" };
  }

  for (const toolId of allowedToolIds) {
    if (!SUPPORTED_LLM_TOOL_IDS.has(toolId)) {
      return { success: false, error: `unsupported tool id in allowlist: ${toolId}` };
    }
  }

  const modelResolved = input.languageModelOverride
    ? { model: input.languageModelOverride, providerId: "override", modelId: "override" }
    : await resolveLanguageModel({
        container: input.container,
        tenantId: input.executionContext.tenantId,
        secretProvider: input.secretProvider,
        model: modelIdRaw,
      });

  const toolBudget: ToolBudgetState = { toolCallsUsed: 0, countedToolCallIds: new Set<string>() };
  const toolCallPolicyStates = new Map<string, ToolCallPolicyState>();
  let stepsUsedSoFar = 0;
  let messages: ModelMessage[] = [
    {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: `${formatOutputContractPrompt(outputContract)}\n\nStep prompt:\n${prompt}`,
        },
      ],
    },
  ];

  const buildCost = (usage2?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }): AttemptCostT => {
    const durationMs = Math.max(0, Date.now() - startedAt);
    return {
      duration_ms: durationMs,
      input_tokens: usage2?.inputTokens,
      output_tokens: usage2?.outputTokens,
      total_tokens: usage2?.totalTokens,
      model: modelResolved.modelId,
      provider: modelResolved.providerId,
    };
  };

  const stepApprovalId = input.executionContext.approvalId;
  if (stepApprovalId) {
    const row = await input.container.db.get<{
      status: string;
      context_json: string;
      latest_review_reason: string | null;
    }>(
      `SELECT a.status, a.context_json, r.reason AS latest_review_reason
       FROM approvals a
       LEFT JOIN review_entries r
         ON r.tenant_id = a.tenant_id
        AND r.review_id = a.latest_review_id
       WHERE a.tenant_id = ? AND a.approval_id = ?`,
      [input.executionContext.tenantId, stepApprovalId],
    );
    if (row && !isApprovalBlockedStatus(row.status as never)) {
      let approvalContext: unknown = {};
      try {
        approvalContext = JSON.parse(row.context_json) as unknown;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        input.container.logger?.warn("execution.approval_context_parse_failed", {
          approval_id: stepApprovalId,
          error: message,
        });
        approvalContext = {};
      }

      const resumeState = extractToolApprovalResumeState(approvalContext);
      if (resumeState) {
        stepsUsedSoFar = resumeState.steps_used ?? countAssistantMessages(resumeState.messages);
        if (resumeState.tool_calls_used !== undefined) {
          toolBudget.toolCallsUsed = resumeState.tool_calls_used;
        }
        if (resumeState.counted_tool_call_ids) {
          toolBudget.countedToolCallIds = new Set<string>(resumeState.counted_tool_call_ids);
        }

        messages = appendToolApprovalResponseMessage(resumeState.messages, {
          approvalId: resumeState.approval_id,
          approved: row.status === "approved",
          reason:
            row.latest_review_reason ??
            (row.status === "expired"
              ? "approval expired"
              : row.status === "cancelled"
                ? "approval cancelled"
                : undefined),
        });
      }
    }
  }

  const toolSet = buildToolSet({
    planId: input.planId,
    stepIndex: input.stepIndex,
    timeoutMs: input.timeoutMs,
    allowedToolIds,
    maxToolCalls,
    toolExecutor: input.toolExecutor,
    toolBudget,
    executionContext: input.executionContext,
    container: input.container,
    secretProvider: input.secretProvider,
    languageModel: modelResolved.model as unknown as LanguageModel,
    toolCallPolicyStates,
  });

  const maxStepsTotal = maxToolCalls <= 0 ? 1 : Math.max(3, maxToolCalls * 2 + 3);
  const remainingSteps = maxStepsTotal - stepsUsedSoFar;
  if (remainingSteps <= 0) {
    return { success: false, error: "No assistant response returned.", cost: buildCost() };
  }

  let resultText: string;
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
  let stepsUsedAfterCall = stepsUsedSoFar;
  let responseMessages: ModelMessage[] = [];
  let approvalRequest:
    | { approvalId: string; toolCallId: string; toolName: string; toolArgs?: unknown }
    | undefined;
  let toolError: { toolName: string; message: string } | undefined;
  try {
    const res = await generateText({
      model: modelResolved.model as unknown as LanguageModel,
      system: [
        "You are executing an LLM step inside a deterministic playbook.",
        "Return only the final JSON value that satisfies the output contract.",
        "Do not emit prose, Markdown fences, commentary, or any wrapper text.",
      ].join("\n"),
      messages,
      tools: toolSet,
      stopWhen: [() => toolBudget.limitExceededError !== undefined, stepCountIs(remainingSteps)],
      timeout: input.timeoutMs,
    });

    resultText = (res.text ?? "").trim();
    usage = {
      inputTokens: res.totalUsage?.inputTokens,
      outputTokens: res.totalUsage?.outputTokens,
      totalTokens: res.totalUsage?.totalTokens,
    };
    responseMessages = (res.response?.messages ?? []) as unknown as ModelMessage[];

    stepsUsedAfterCall = stepsUsedSoFar + (res.steps?.length ?? 0);

    if (res.steps) {
      const lastStep = res.steps.at(-1);
      const approvalPart = lastStep?.content.find(
        (part) => coerceRecord(part)?.["type"] === "tool-approval-request",
      );
      if (approvalPart) {
        const record = coerceRecord(approvalPart);
        const approvalId =
          typeof record?.["approvalId"] === "string" ? record["approvalId"].trim() : "";
        const toolCall = coerceRecord(record?.["toolCall"]);

        const toolCallId =
          typeof toolCall?.["toolCallId"] === "string" ? toolCall["toolCallId"].trim() : "";
        const toolName =
          typeof toolCall?.["toolName"] === "string" ? toolCall["toolName"].trim() : "";
        const toolArgs = toolCall ? toolCall["input"] : undefined;

        if (!approvalId || !toolCallId || !toolName) {
          throw new Error("tool approval request missing required fields");
        }

        approvalRequest = { approvalId, toolCallId, toolName, toolArgs };
      }
    }

    if (res.steps) {
      for (const step of res.steps) {
        for (const part of step.content) {
          if (part.type !== "tool-error") continue;
          toolError = {
            toolName: String(part.toolName),
            message: extractToolErrorMessage(part.error),
          };
          break;
        }
        if (toolError) break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, cost: buildCost(usage) };
  }

  if (toolBudget.limitExceededError) {
    return { success: false, error: toolBudget.limitExceededError, cost: buildCost(usage) };
  }

  if (toolError) {
    return {
      success: false,
      error: `Tool execution failed: ${toolError.toolName} (${toolError.message})`,
      cost: buildCost(usage),
    };
  }

  if (approvalRequest) {
    const policyState = toolCallPolicyStates.get(approvalRequest.toolCallId);
    if (!policyState) {
      return {
        success: false,
        error: `tool approval request missing policy state for tool_call_id=${approvalRequest.toolCallId}`,
        cost: buildCost(usage),
      };
    }

    const expiresAt = new Date(Date.now() + DEFAULT_TOOL_APPROVAL_WAIT_MS).toISOString();

    return {
      success: true,
      pause: {
        kind: "policy",
        prompt: `Approve execution of '${policyState.toolId}'`,
        detail: `approval required for tool '${policyState.toolId}'`,
        expiresAt,
        context: {
          source: "llm-step-tool-execution",
          tool_id: policyState.toolId,
          tool_call_id: policyState.toolCallId,
          tool_match_target: policyState.matchTarget,
          ai_sdk: {
            approval_id: approvalRequest.approvalId,
            messages: [...messages, ...responseMessages],
            steps_used: stepsUsedAfterCall,
            tool_calls_used: toolBudget.toolCallsUsed,
            counted_tool_call_ids: Array.from(toolBudget.countedToolCallIds),
          },
        },
      },
      cost: buildCost(usage),
    };
  }

  if (!resultText) {
    return { success: false, error: "No assistant response returned.", cost: buildCost(usage) };
  }

  const maxOutputBytes = resolveMaxOutputBytes(args);
  const capped = maybeTruncateText(resultText, maxOutputBytes);
  if (capped.truncated) {
    return {
      success: false,
      error: "Output contract violated: model output was truncated",
      cost: buildCost(usage),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(resultText) as unknown;
  } catch (err) {
    // Intentional: output contract violation is returned as a structured StepResult.
    void err;
    return {
      success: false,
      error: "Output contract violated: expected JSON model output",
      cost: buildCost(usage),
    };
  }

  if (outputContract.schema !== undefined) {
    const schemaError = validateJsonAgainstSchema(parsed, outputContract.schema);
    if (schemaError) {
      return {
        success: false,
        error: `Output contract violated: model output failed schema validation (${schemaError})`,
        evidence: { json: parsed },
        cost: buildCost(usage),
      };
    }
  }

  const cost = buildCost(usage);

  const resultPayload = {
    ok: true,
    type: input.action.type,
    model: modelIdRaw,
    tool_calls_allowed: maxToolCalls,
  };

  return { success: true, result: resultPayload, evidence: { json: parsed }, cost };
}

export function createGatewayStepExecutor(input: {
  container: GatewayContainer;
  toolExecutor: StepExecutor;
  /** Optional LanguageModel override (primarily for tests). */
  languageModel?: LanguageModel;
  decideExecutor?: (input: {
    request: AgentTurnRequestT;
    planId: string;
    stepIndex: number;
    timeoutMs: number;
    context: StepExecutionContext;
  }) => Promise<StepResult>;
}): StepExecutor {
  return {
    execute: async (
      action: ActionPrimitiveT,
      planId: string,
      stepIndex: number,
      timeoutMs: number,
      context: StepExecutionContext,
    ): Promise<StepResult> => {
      if (action.type === "Llm") {
        return await executeLlmAction({
          action,
          planId,
          stepIndex,
          timeoutMs,
          container: input.container,
          toolExecutor: input.toolExecutor,
          executionContext: context,
          languageModelOverride: input.languageModel,
        });
      }

      if (action.type === "Decide") {
        if (!input.decideExecutor) {
          return { success: false, error: "decide execution is not configured" };
        }

        const parsed = AgentTurnRequest.safeParse(action.args ?? {});
        if (!parsed.success) {
          return { success: false, error: `invalid agent turn request: ${parsed.error.message}` };
        }

        return await input.decideExecutor({
          request: parsed.data,
          planId,
          stepIndex,
          timeoutMs,
          context,
        });
      }

      return await input.toolExecutor.execute(action, planId, stepIndex, timeoutMs, context);
    },
  };
}
