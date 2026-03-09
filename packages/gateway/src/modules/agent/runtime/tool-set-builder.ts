import { randomUUID } from "node:crypto";
import { jsonSchema, tool as aiTool } from "ai";
import type { LanguageModel, ModelMessage, Tool, ToolExecutionOptions, ToolSet } from "ai";
import type { Decision } from "@tyrum/schemas";
import { buildModelToolNameMap, registerModelTool, type ToolDescriptor } from "../tools.js";
import type { ToolExecutor, ToolResult } from "../tool-executor.js";
import { tagContent } from "../provenance.js";
import { sanitizeForModel, containsInjectionPatterns } from "../sanitizer.js";
import { runWebFetchExtractionPass } from "../webfetch-extraction.js";
import type { AgentContextReport } from "./types.js";
import type { LaneQueueState } from "./turn-engine-bridge.js";
import { collectSecretHandleIds } from "../../secret/collect-secret-handle-ids.js";
import { canonicalizeToolMatchTarget } from "../../policy/match-target.js";
import { suggestedOverridesForToolCall } from "../../policy/suggested-overrides.js";
import { hasToolResult } from "../../ai-sdk/message-utils.js";
import { coerceRecord } from "../../util/coerce.js";
import { LaneQueueInterruptError } from "../../lanes/queue-signal-dal.js";
import { resolvePolicyGatedPluginToolExposure } from "./plugin-tool-policy.js";
import {
  coerceSecretHandle,
  extractApprovalReason,
  notApprovedJson,
  awaitApprovalForToolExecution,
} from "./tool-set-builder-helpers.js";
import type {
  ToolExecutionContext,
  ToolCallPolicyState,
  ToolSetBuilderDeps,
} from "./tool-set-builder-helpers.js";

export type { ToolCallPolicyState, ToolSetBuilderDeps } from "./tool-set-builder-helpers.js";

export class ToolSetBuilder {
  constructor(private readonly deps: ToolSetBuilderDeps) {}

  private async maybeExtractWebFetchResult(input: {
    toolDesc: ToolDescriptor;
    args: unknown;
    result: ToolResult;
    model?: LanguageModel;
    toolCallId: string;
  }): Promise<ToolResult> {
    if (input.toolDesc.id !== "webfetch" || !input.model || input.result.error) {
      return input.result;
    }

    const rawContent = input.result.provenance?.content ?? input.result.output;
    const extraction = await runWebFetchExtractionPass({
      args: input.args,
      rawContent,
      model: input.model,
      toolCallId: input.toolCallId,
      logger: this.deps.logger,
    });
    if (!extraction) return input.result;

    return {
      ...input.result,
      output: extraction.output,
      provenance: extraction.provenance,
    };
  }

  buildToolSet(
    tools: readonly ToolDescriptor[],
    toolExecutor: ToolExecutor,
    usedTools: Set<string>,
    toolExecutionContext: ToolExecutionContext,
    contextReport: AgentContextReport,
    laneQueue?: LaneQueueState,
    toolCallPolicyStates?: Map<string, ToolCallPolicyState>,
    model?: LanguageModel,
  ): ToolSet {
    const result: Record<string, Tool> = {};
    const modelToolNames = buildModelToolNameMap(tools.map((tool) => tool.id));
    let approvalStepIndex = 0;
    let drivingProvenance: { source: string; trusted: boolean } = { source: "user", trusted: true };
    const syncLaneQueue = async (): Promise<"interrupt" | "steer" | undefined> => {
      if (!laneQueue) return undefined;
      if (laneQueue.cancelToolCalls || laneQueue.interruptError) {
        return laneQueue.interruptError ? "interrupt" : "steer";
      }
      const signal = await laneQueue.signals.claimSignal({
        tenant_id: laneQueue.tenant_id,
        ...laneQueue.scope,
      });
      if (signal?.kind === "interrupt") {
        laneQueue.interruptError ??= new LaneQueueInterruptError();
        laneQueue.cancelToolCalls = true;
      }
      if (signal?.kind === "steer") {
        const text = signal.message_text.trim();
        if (text.length > 0) laneQueue.pendingInjectionTexts.push(text);
        laneQueue.cancelToolCalls = true;
      }
      return laneQueue.cancelToolCalls
        ? laneQueue.interruptError
          ? "interrupt"
          : "steer"
        : undefined;
    };

    const resolveToolCallPolicyState = async (input: {
      toolDesc: ToolDescriptor;
      toolCallId: string;
      args: unknown;
      inputProvenance: { source: string; trusted: boolean };
    }): Promise<ToolCallPolicyState> => {
      const existing = toolCallPolicyStates?.get(input.toolCallId);
      if (existing && existing.toolDesc.id === input.toolDesc.id) return existing;
      const matchTarget = canonicalizeToolMatchTarget(
        input.toolDesc.id,
        input.args,
        this.deps.home,
      );

      const policy = this.deps.policyService;
      const policyEnabled = policy.isEnabled();

      let policyDecision: Decision | undefined;
      let policySnapshotId: string | undefined;
      let appliedOverrideIds: string[] | undefined;

      if (policyEnabled) {
        const agentId = this.deps.agentId;
        const workspaceId = this.deps.workspaceId;
        const url =
          input.toolDesc.id === "webfetch" &&
          input.args &&
          typeof (input.args as Record<string, unknown>)["url"] === "string"
            ? String((input.args as Record<string, unknown>)["url"])
            : undefined;

        const handleIds = collectSecretHandleIds(input.args);
        const secretScopes: string[] = [];
        if (handleIds.length > 0 && this.deps.secretProvider) {
          const handles = await this.deps.secretProvider.list();
          for (const id of handleIds) {
            const handle = handles.find((h) => h.handle_id === id);
            if (handle?.scope) {
              secretScopes.push(`${handle.provider}:${handle.scope}`);
            } else {
              secretScopes.push(id);
            }
          }
        }

        const evaluation = await policy.evaluateToolCall({
          tenantId: this.deps.tenantId,
          agentId,
          workspaceId,
          toolId: input.toolDesc.id,
          toolMatchTarget: matchTarget,
          url,
          secretScopes: secretScopes.length > 0 ? secretScopes : undefined,
          inputProvenance: input.inputProvenance,
        });
        policyDecision = evaluation.decision;
        policySnapshotId = evaluation.policy_snapshot?.policy_snapshot_id;
        appliedOverrideIds = evaluation.applied_override_ids;
      }

      const shouldRequireApproval =
        policyEnabled && !policy.isObserveOnly()
          ? policyDecision === "require_approval"
          : input.toolDesc.requires_confirmation;
      const suggestedOverrides = policyEnabled
        ? suggestedOverridesForToolCall({
            toolId: input.toolDesc.id,
            matchTarget,
            workspaceId: this.deps.workspaceId,
          })
        : undefined;
      const state: ToolCallPolicyState = {
        toolDesc: input.toolDesc,
        toolCallId: input.toolCallId,
        args: input.args,
        matchTarget,
        inputProvenance: input.inputProvenance,
        policyDecision,
        policySnapshotId,
        appliedOverrideIds,
        suggestedOverrides,
        approvalStepIndex: existing?.approvalStepIndex,
        shouldRequireApproval,
      };

      toolCallPolicyStates?.set(input.toolCallId, state);
      return state;
    };

    const resolveResumedToolArgs = async (input: {
      toolId: string;
      toolCallId: string;
      args: unknown;
    }): Promise<unknown> => {
      const execution = toolExecutionContext.execution;
      if (!execution?.stepApprovalId) return input.args;

      const secretProvider = this.deps.secretProvider;
      if (!secretProvider) return input.args;

      const approval = await this.deps.approvalDal.getById({
        tenantId: this.deps.tenantId,
        approvalId: execution.stepApprovalId,
      });
      const ctx = coerceRecord(approval?.context);
      if (!ctx || ctx["source"] !== "agent-tool-execution") return input.args;
      if (ctx["tool_id"] !== input.toolId || ctx["tool_call_id"] !== input.toolCallId) {
        return input.args;
      }

      const aiSdk = coerceRecord(ctx["ai_sdk"]);
      const handle = coerceSecretHandle(aiSdk?.["tool_args_handle"]);
      if (!handle) return input.args;

      const raw = await secretProvider.resolve(handle);
      if (!raw) return input.args;

      try {
        return JSON.parse(raw) as unknown;
      } catch {
        // Intentional: stored args may be missing/corrupt; fall back to the args provided by the model.
        return input.args;
      }
    };

    for (const toolDesc of tools) {
      const schema = toolDesc.inputSchema ?? { type: "object", additionalProperties: true };

      const modelTool = aiTool({
        description: toolDesc.description,
        inputSchema: jsonSchema(schema),
        needsApproval: toolExecutionContext.execution
          ? async (
              args: unknown,
              options: {
                toolCallId: string;
                messages: ModelMessage[];
                experimental_context?: unknown;
              },
            ): Promise<boolean> => {
              if (await syncLaneQueue()) return false;
              const effectiveArgs = await resolveResumedToolArgs({
                toolId: toolDesc.id,
                toolCallId: options.toolCallId,
                args,
              });
              const state = await resolveToolCallPolicyState({
                toolDesc,
                toolCallId: options.toolCallId,
                args: effectiveArgs,
                inputProvenance: { ...drivingProvenance },
              });
              if (!state.shouldRequireApproval) return false;

              const stepApprovalId = toolExecutionContext.execution?.stepApprovalId;
              if (stepApprovalId) {
                const approval = await this.deps.approvalDal.getById({
                  tenantId: this.deps.tenantId,
                  approvalId: stepApprovalId,
                });
                if (
                  approval &&
                  (approval.status === "approved" ||
                    approval.status === "denied" ||
                    approval.status === "expired")
                ) {
                  const ctx = coerceRecord(approval.context);
                  const matches =
                    ctx?.["source"] === "agent-tool-execution" &&
                    ctx["tool_id"] === toolDesc.id &&
                    ctx["tool_call_id"] === options.toolCallId &&
                    ctx["tool_match_target"] === state.matchTarget;
                  if (matches && !hasToolResult(options.messages, options.toolCallId)) return false;
                }
              }

              if (state.approvalStepIndex === undefined) {
                state.approvalStepIndex = approvalStepIndex++;
                toolCallPolicyStates?.set(options.toolCallId, state);
              }

              return true;
            }
          : undefined,
        execute: async (args: unknown, options: ToolExecutionOptions) => {
          const cancelReason = await syncLaneQueue();
          if (cancelReason) return JSON.stringify({ error: "cancelled", reason: cancelReason });

          const toolCallId =
            typeof options?.toolCallId === "string" && options.toolCallId.trim().length > 0
              ? options.toolCallId.trim()
              : `tc-${randomUUID()}`;

          const effectiveArgs = await resolveResumedToolArgs({
            toolId: toolDesc.id,
            toolCallId,
            args,
          });
          const state = await resolveToolCallPolicyState({
            toolDesc,
            toolCallId,
            args: effectiveArgs,
            inputProvenance: { ...drivingProvenance },
          });

          const policy = this.deps.policyService;
          const policyEnabled = policy.isEnabled();
          const policySnapshotId = state.policySnapshotId;

          if (policyEnabled && state.policyDecision === "deny" && !policy.isObserveOnly())
            return JSON.stringify({
              error: `policy denied tool execution for '${toolDesc.id}'`,
              decision: "deny",
            });

          if (state.shouldRequireApproval) {
            const policyContext = {
              policy_snapshot_id: policySnapshotId,
              agent_id: this.deps.agentId,
              workspace_id: this.deps.workspaceId,
              suggested_overrides: state.suggestedOverrides,
              applied_override_ids: state.appliedOverrideIds,
            };
            const approvalStepIndexValue =
              state.approvalStepIndex === undefined
                ? (() => {
                    const next = approvalStepIndex++;
                    state.approvalStepIndex = next;
                    toolCallPolicyStates?.set(toolCallId, state);
                    return next;
                  })()
                : state.approvalStepIndex;

            if (toolExecutionContext.execution) {
              const stepApprovalId = toolExecutionContext.execution.stepApprovalId;
              if (!stepApprovalId) return notApprovedJson(toolDesc.id, "pending");

              const approval = await this.deps.approvalDal.getById({
                tenantId: this.deps.tenantId,
                approvalId: stepApprovalId,
              });
              const approved = approval?.status === "approved";
              const ctx = coerceRecord(approval?.context);
              const matches =
                ctx?.["source"] === "agent-tool-execution" &&
                ctx["tool_id"] === toolDesc.id &&
                ctx["tool_call_id"] === toolCallId &&
                ctx["tool_match_target"] === state.matchTarget;

              if (!approved || !matches)
                return notApprovedJson(
                  toolDesc.id,
                  approval?.status ?? "pending",
                  stepApprovalId,
                  extractApprovalReason(approval),
                );
            } else {
              const decision = await awaitApprovalForToolExecution(
                this.deps,
                toolDesc,
                effectiveArgs,
                toolCallId,
                toolExecutionContext,
                approvalStepIndexValue,
                policyContext,
              );
              if (!decision.approved)
                return notApprovedJson(
                  toolDesc.id,
                  decision.status,
                  decision.approvalId,
                  decision.reason,
                );
            }
          }

          usedTools.add(toolDesc.id);
          const pluginRes = await this.deps.plugins?.executeTool({
            toolId: toolDesc.id,
            toolCallId,
            args: effectiveArgs,
            home: this.deps.stateMode === "shared" ? "" : this.deps.home,
            agentId: this.deps.agentId,
            workspaceId: this.deps.workspaceId,
            auditPlanId: toolExecutionContext.planId,
            sessionId: toolExecutionContext.sessionId,
            channel: toolExecutionContext.channel,
            threadId: toolExecutionContext.threadId,
            policySnapshotId,
          });

          const executedRes: ToolResult = pluginRes
            ? (() => {
                const tagged = tagContent(pluginRes.output, "tool", false);
                return {
                  tool_call_id: toolCallId,
                  output: sanitizeForModel(tagged),
                  error: pluginRes.error,
                  provenance: tagged,
                };
              })()
            : await toolExecutor.execute(toolDesc.id, toolCallId, effectiveArgs, {
                agent_id: this.deps.agentId,
                workspace_id: this.deps.workspaceId,
                session_id: toolExecutionContext.sessionId,
                channel: toolExecutionContext.channel,
                thread_id: toolExecutionContext.threadId,
                execution_run_id: toolExecutionContext.execution?.runId,
                execution_step_id: toolExecutionContext.execution?.stepId,
                policy_snapshot_id: policySnapshotId,
              });
          const res = await this.maybeExtractWebFetchResult({
            toolDesc,
            args: effectiveArgs,
            result: executedRes,
            model,
            toolCallId,
          });

          if (pluginRes && this.deps.redactionEngine) {
            const redact = (text: string): string =>
              this.deps.redactionEngine?.redactText(text).redacted ?? text;
            res.output = redact(res.output);
            if (res.error) {
              res.error = redact(res.error);
            }
            if (res.provenance)
              res.provenance = { ...res.provenance, content: redact(res.provenance.content) };
          }

          if (res.provenance)
            drivingProvenance = { source: res.provenance.source, trusted: res.provenance.trusted };

          let content = res.error ? JSON.stringify({ error: res.error }) : res.output;

          if (
            res.provenance &&
            !res.provenance.trusted &&
            containsInjectionPatterns(res.provenance.content)
          ) {
            content = `[SECURITY: This tool output contained potential prompt injection patterns that were neutralized.]\n${content}`;
          }

          contextReport.tool_calls.push({
            tool_call_id: toolCallId,
            tool_id: toolDesc.id,
            injected_chars: content.length,
          });

          if (res.meta?.kind === "fs.read") {
            contextReport.injected_files.push({
              tool_call_id: toolCallId,
              path: res.meta.path,
              offset: res.meta.offset,
              limit: res.meta.limit,
              raw_chars: res.meta.raw_chars,
              selected_chars: res.meta.selected_chars,
              injected_chars: content.length,
              truncated: res.meta.truncated,
              truncation_marker: res.meta.truncation_marker,
            });
          }

          return content;
        },
      });
      registerModelTool(result, toolDesc.id, modelTool, modelToolNames);
    }

    return result;
  }

  async resolvePolicyGatedPluginToolExposure(params: {
    allowlist: readonly string[];
    pluginTools: readonly ToolDescriptor[];
  }): Promise<{ allowlist: string[]; pluginTools: ToolDescriptor[] }> {
    return await resolvePolicyGatedPluginToolExposure({
      policyService: this.deps.policyService,
      tenantId: this.deps.tenantId,
      agentId: this.deps.agentId,
      allowlist: params.allowlist,
      pluginTools: params.pluginTools,
    });
  }
}
