import { randomUUID } from "node:crypto";
import { jsonSchema, tool as aiTool } from "ai";
import type { ModelMessage, Tool, ToolExecutionOptions, ToolSet } from "ai";
import type { Decision, SecretHandle as SecretHandleT } from "@tyrum/schemas";
import { buildModelToolNameMap, registerModelTool, type ToolDescriptor } from "../tools.js";
import type { ToolExecutor, ToolResult } from "../tool-executor.js";
import { tagContent } from "../provenance.js";
import { sanitizeForModel, containsInjectionPatterns } from "../sanitizer.js";
import type { AgentContextReport } from "./types.js";
import type { LaneQueueState } from "./turn-engine-bridge.js";
import type { SecretProvider } from "../../secret/provider.js";
import { collectSecretHandleIds } from "../../secret/collect-secret-handle-ids.js";
import type { ApprovalNotifier } from "../../approval/notifier.js";
import type { ApprovalDal, ApprovalStatus } from "../../approval/dal.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { PolicyService } from "../../policy/service.js";
import { canonicalizeToolMatchTarget } from "../../policy/match-target.js";
import {
  suggestedOverridesForToolCall,
  type SuggestedOverride,
} from "../../policy/suggested-overrides.js";
import { wildcardMatch } from "../../policy/wildcard.js";
import { hasToolResult } from "../../ai-sdk/message-utils.js";
import { coerceRecord } from "../../util/coerce.js";
import { LaneQueueInterruptError } from "../../lanes/queue-signal-dal.js";

interface ToolExecutionContext {
  tenantId: string;
  planId: string;
  sessionId: string;
  channel: string;
  threadId: string;
  execution?: {
    runId: string;
    stepIndex: number;
    stepId: string;
    stepApprovalId?: string;
  };
}

export type ToolCallPolicyState = {
  toolDesc: ToolDescriptor;
  toolCallId: string;
  args: unknown;
  matchTarget: string;
  inputProvenance: { source: string; trusted: boolean };
  policyDecision?: Decision;
  policySnapshotId?: string;
  appliedOverrideIds?: string[];
  suggestedOverrides?: SuggestedOverride[];
  approvalStepIndex?: number;
  shouldRequireApproval: boolean;
};

function coerceSecretHandle(value: unknown): SecretHandleT | undefined {
  const record = coerceRecord(value);
  if (!record) return undefined;
  const handleId = typeof record["handle_id"] === "string" ? record["handle_id"].trim() : "";
  const provider = typeof record["provider"] === "string" ? record["provider"].trim() : "";
  const scope = typeof record["scope"] === "string" ? record["scope"].trim() : "";
  const createdAt = typeof record["created_at"] === "string" ? record["created_at"].trim() : "";
  if (!handleId || !provider || !scope || !createdAt) return undefined;
  if (provider !== "db") return undefined;
  return {
    handle_id: handleId,
    provider: "db",
    scope,
    created_at: createdAt,
  };
}

function extractApprovalReason(
  approval: { resolution: unknown | null } | undefined,
): string | undefined {
  const record = coerceRecord(approval?.resolution);
  const reason = typeof record?.["reason"] === "string" ? record["reason"].trim() : "";
  return reason.length > 0 ? reason : undefined;
}

function isSideEffectingPluginTool(tool: ToolDescriptor): boolean {
  const id = tool.id.trim();
  return id.startsWith("plugin.") && tool.requires_confirmation;
}

type ToolSetBuilderLogger = {
  info: (message: string, fields?: Record<string, unknown>) => void;
};

type ToolSetBuilderRedactionEngine = {
  redactText: (text: string) => { redacted: string };
};

export interface ToolSetBuilderDeps {
  home: string;
  tenantId: string;
  agentId: string;
  workspaceId: string;
  policyService: PolicyService;
  approvalDal: ApprovalDal;
  approvalNotifier: ApprovalNotifier;
  approvalWaitMs: number;
  approvalPollMs: number;
  logger: ToolSetBuilderLogger;
  secretProvider?: SecretProvider;
  plugins?: PluginRegistry;
  redactionEngine?: ToolSetBuilderRedactionEngine;
}

export class ToolSetBuilder {
  constructor(private readonly deps: ToolSetBuilderDeps) {}

  buildToolSet(
    tools: readonly ToolDescriptor[],
    toolExecutor: ToolExecutor,
    usedTools: Set<string>,
    toolExecutionContext: ToolExecutionContext,
    contextReport: AgentContextReport,
    laneQueue?: LaneQueueState,
    toolCallPolicyStates?: Map<string, ToolCallPolicyState>,
  ): ToolSet {
    const result: Record<string, Tool> = {};
    const modelToolNames = buildModelToolNameMap(tools.map((tool) => tool.id));
    let approvalStepIndex = 0;
    let drivingProvenance: { source: string; trusted: boolean } = {
      source: "user",
      trusted: true,
    };

    const resolveToolCallPolicyState = async (input: {
      toolDesc: ToolDescriptor;
      toolCallId: string;
      args: unknown;
      inputProvenance: { source: string; trusted: boolean };
    }): Promise<ToolCallPolicyState> => {
      const existing = toolCallPolicyStates?.get(input.toolCallId);
      if (existing && existing.toolDesc.id === input.toolDesc.id) {
        return existing;
      }

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
          input.toolDesc.id === "tool.http.fetch" &&
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
      if (!secretProvider) {
        return input.args;
      }

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
              if (laneQueue) {
                if (laneQueue.cancelToolCalls || laneQueue.interruptError) {
                  return false;
                }

                const signal = await laneQueue.signals.claimSignal({
                  tenant_id: laneQueue.tenant_id,
                  ...laneQueue.scope,
                });
                if (signal?.kind === "interrupt") {
                  laneQueue.interruptError ??= new LaneQueueInterruptError();
                  laneQueue.cancelToolCalls = true;
                  return false;
                }
                if (signal?.kind === "steer") {
                  const text = signal.message_text.trim();
                  if (text.length > 0) {
                    laneQueue.pendingInjectionTexts.push(text);
                  }
                  laneQueue.cancelToolCalls = true;
                  return false;
                }
              }

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

              if (!state.shouldRequireApproval) {
                return false;
              }

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
                  if (matches && !hasToolResult(options.messages, options.toolCallId)) {
                    return false;
                  }
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
          if (laneQueue) {
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
              if (text.length > 0) {
                laneQueue.pendingInjectionTexts.push(text);
              }
              laneQueue.cancelToolCalls = true;
            }

            if (laneQueue.cancelToolCalls) {
              return JSON.stringify({
                error: "cancelled",
                reason: laneQueue.interruptError ? "interrupt" : "steer",
              });
            }
          }

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

          if (policyEnabled && state.policyDecision === "deny" && !policy.isObserveOnly()) {
            return JSON.stringify({
              error: `policy denied tool execution for '${toolDesc.id}'`,
              decision: "deny",
            });
          }

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
              if (!stepApprovalId) {
                return JSON.stringify({
                  error: `tool execution not approved for '${toolDesc.id}'`,
                  status: "pending",
                });
              }

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

              if (!approved || !matches) {
                return JSON.stringify({
                  error: `tool execution not approved for '${toolDesc.id}'`,
                  approval_id: stepApprovalId,
                  status: approval?.status ?? "pending",
                  reason: extractApprovalReason(approval),
                });
              }
            } else {
              const decision = await this.awaitApprovalForToolExecution(
                toolDesc,
                effectiveArgs,
                toolCallId,
                toolExecutionContext,
                approvalStepIndexValue,
                policyContext,
              );
              if (!decision.approved) {
                return JSON.stringify({
                  error: `tool execution not approved for '${toolDesc.id}'`,
                  approval_id: decision.approvalId,
                  status: decision.status,
                  reason: decision.reason,
                });
              }
            }
          }

          usedTools.add(toolDesc.id);
          const agentId = this.deps.agentId;
          const workspaceId = this.deps.workspaceId;

          const pluginRes = await this.deps.plugins?.executeTool({
            toolId: toolDesc.id,
            toolCallId,
            args: effectiveArgs,
            home: this.deps.home,
            agentId,
            workspaceId,
            auditPlanId: toolExecutionContext.planId,
            sessionId: toolExecutionContext.sessionId,
            channel: toolExecutionContext.channel,
            threadId: toolExecutionContext.threadId,
            policySnapshotId,
          });

          const res: ToolResult = pluginRes
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
                agent_id: agentId,
                workspace_id: workspaceId,
                session_id: toolExecutionContext.sessionId,
                channel: toolExecutionContext.channel,
                thread_id: toolExecutionContext.threadId,
                execution_run_id: toolExecutionContext.execution?.runId,
                execution_step_id: toolExecutionContext.execution?.stepId,
                policy_snapshot_id: policySnapshotId,
              });

          if (pluginRes && this.deps.redactionEngine) {
            const redact = (text: string): string =>
              this.deps.redactionEngine?.redactText(text).redacted ?? text;
            res.output = redact(res.output);
            if (res.error) {
              res.error = redact(res.error);
            }
            if (res.provenance) {
              res.provenance = {
                ...res.provenance,
                content: redact(res.provenance.content),
              };
            }
          }

          if (res.provenance) {
            drivingProvenance = {
              source: res.provenance.source,
              trusted: res.provenance.trusted,
            };
          }

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

  private async awaitApprovalForToolExecution(
    tool: ToolDescriptor,
    args: unknown,
    toolCallId: string,
    context: ToolExecutionContext,
    stepIndex: number,
    policyContext?: {
      policy_snapshot_id?: string;
      agent_id?: string;
      workspace_id?: string;
      suggested_overrides?: unknown;
      applied_override_ids?: string[];
    },
  ): Promise<{
    approved: boolean;
    status: ApprovalStatus;
    approvalId: string;
    reason?: string;
  }> {
    const deadline = Date.now() + this.deps.approvalWaitMs;
    const approvalKey = `${context.planId}:step:${String(stepIndex)}:tool_call:${toolCallId}`;
    const approval = await this.deps.approvalDal.create({
      tenantId: this.deps.tenantId,
      kind: "workflow_step",
      agentId: this.deps.agentId,
      workspaceId: this.deps.workspaceId,
      approvalKey,
      prompt: `Approve execution of '${tool.id}' (risk=${tool.risk})`,
      context: {
        source: "agent-tool-execution",
        tool_id: tool.id,
        tool_risk: tool.risk,
        tool_call_id: toolCallId,
        args,
        session_id: context.sessionId,
        channel: context.channel,
        thread_id: context.threadId,
        policy: policyContext ?? undefined,
      },
      expiresAt: new Date(deadline).toISOString(),
      sessionId: context.sessionId,
      runId: context.execution?.runId,
      stepId: context.execution?.stepId,
    });

    this.deps.logger.info("approval.created", {
      approval_id: approval.approval_id,
      plan_id: context.planId,
      step_index: stepIndex,
      tool_id: tool.id,
      tool_risk: tool.risk,
      tool_call_id: toolCallId,
      expires_at: approval.expires_at,
    });

    this.deps.approvalNotifier.notify(approval);

    while (Date.now() < deadline) {
      await this.deps.approvalDal.expireStale({ tenantId: this.deps.tenantId });
      const current = await this.deps.approvalDal.getById({
        tenantId: this.deps.tenantId,
        approvalId: approval.approval_id,
      });
      if (!current) {
        return {
          approved: false,
          status: "expired",
          approvalId: approval.approval_id,
          reason: "approval record not found",
        };
      }

      if (current.status === "approved") {
        return {
          approved: true,
          status: "approved",
          approvalId: current.approval_id,
          reason: extractApprovalReason(current),
        };
      }

      if (current.status === "denied" || current.status === "expired") {
        return {
          approved: false,
          status: current.status,
          approvalId: current.approval_id,
          reason: extractApprovalReason(current),
        };
      }

      const sleepMs = Math.min(this.deps.approvalPollMs, Math.max(1, deadline - Date.now()));
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }

    const expired = await this.deps.approvalDal.expireById({
      tenantId: this.deps.tenantId,
      approvalId: approval.approval_id,
    });
    return {
      approved: false,
      status: "expired",
      approvalId: approval.approval_id,
      reason: extractApprovalReason(expired) ?? "approval timed out",
    };
  }

  async resolvePolicyGatedPluginToolExposure(params: {
    allowlist: readonly string[];
    pluginTools: readonly ToolDescriptor[];
  }): Promise<{ allowlist: string[]; pluginTools: ToolDescriptor[] }> {
    const policy = this.deps.policyService;

    const pluginTools = params.pluginTools
      .map((tool) => {
        const id = tool.id.trim();
        if (!id) return undefined;
        if (id === tool.id) return tool;
        return { ...tool, id };
      })
      .filter((tool): tool is ToolDescriptor => Boolean(tool));

    const sideEffecting = pluginTools.filter(isSideEffectingPluginTool);
    if (sideEffecting.length === 0) {
      return { allowlist: [...params.allowlist], pluginTools };
    }

    if (!policy.isEnabled() || policy.isObserveOnly()) {
      return { allowlist: [...params.allowlist], pluginTools };
    }

    try {
      const effective = await policy.loadEffectiveBundle();
      const toolsDomain = effective.bundle.tools;
      const deny = toolsDomain?.deny ?? [];
      const allow = toolsDomain?.allow ?? [];
      const requireApproval = toolsDomain?.require_approval ?? [];

      const isOptedIn = (toolId: string): boolean => {
        for (const pat of deny) {
          if (wildcardMatch(pat, toolId)) return false;
        }
        for (const pat of requireApproval) {
          if (wildcardMatch(pat, toolId)) return true;
        }
        for (const pat of allow) {
          if (wildcardMatch(pat, toolId)) return true;
        }
        return false;
      };

      const gatedPluginTools = pluginTools.filter(
        (tool) => !isSideEffectingPluginTool(tool) || isOptedIn(tool.id),
      );

      const allowlist = new Set<string>(params.allowlist);
      for (const tool of gatedPluginTools) {
        if (isSideEffectingPluginTool(tool)) {
          allowlist.add(tool.id);
        }
      }

      return { allowlist: [...allowlist], pluginTools: gatedPluginTools };
    } catch {
      // Intentional: fail closed; side-effecting plugin tools are opt-in and require a readable policy bundle.
      const gatedPluginTools = pluginTools.filter((tool) => !isSideEffectingPluginTool(tool));
      return { allowlist: [...params.allowlist], pluginTools: gatedPluginTools };
    }
  }
}
