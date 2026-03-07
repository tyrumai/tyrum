import { ActionPrimitive as ActionPrimitiveSchema, type ActionPrimitive } from "@tyrum/schemas";
import { DEFAULT_TENANT_ID } from "../identity/scope.js";
import type { IdentityScopeDal } from "../identity/scope.js";
import {
  ScheduleService,
  type ScheduleCadence,
  type ScheduleExecution,
  type ScheduleKind,
} from "../automation/schedule-service.js";
import type { ToolResult, WorkspaceLeaseConfig } from "./tool-executor-shared.js";

type ScheduleExecutorContext = {
  workspaceLease?: WorkspaceLeaseConfig;
  identityScopeDal?: IdentityScopeDal;
};

function getScheduleService(context: ScheduleExecutorContext): ScheduleService {
  const db = context.workspaceLease?.db;
  if (!db || !context.identityScopeDal) {
    throw new Error("automation schedule tools are not configured");
  }
  return new ScheduleService(db, context.identityScopeDal);
}

async function resolveScheduleScope(
  args: unknown,
  context: ScheduleExecutorContext,
): Promise<{
  tenantId: string;
  agentKey?: string;
  workspaceKey?: string;
}> {
  const parsed = args as Record<string, unknown> | null;
  const tenantId = context.workspaceLease?.tenantId ?? DEFAULT_TENANT_ID;
  const agentKey =
    typeof parsed?.["agent_key"] === "string" && parsed["agent_key"].trim().length > 0
      ? parsed["agent_key"].trim()
      : undefined;
  const workspaceKey =
    typeof parsed?.["workspace_key"] === "string" && parsed["workspace_key"].trim().length > 0
      ? parsed["workspace_key"].trim()
      : undefined;
  return { tenantId, agentKey, workspaceKey };
}

function parseScheduleCadence(args: Record<string, unknown> | null): ScheduleCadence | undefined {
  const cadence = args?.["cadence"];
  if (!cadence || typeof cadence !== "object" || Array.isArray(cadence)) return undefined;
  const record = cadence as Record<string, unknown>;

  if (record["type"] === "interval") {
    const intervalMs = record["interval_ms"];
    if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      return undefined;
    }
    return { type: "interval", interval_ms: Math.floor(intervalMs) };
  }

  if (record["type"] === "cron") {
    const expression = typeof record["expression"] === "string" ? record["expression"].trim() : "";
    const timezone = typeof record["timezone"] === "string" ? record["timezone"].trim() : "";
    if (!expression || !timezone) return undefined;
    return { type: "cron", expression, timezone };
  }

  return undefined;
}

function parseScheduleExecution(
  args: Record<string, unknown> | null,
): ScheduleExecution | undefined {
  const execution = args?.["execution"];
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) return undefined;
  const record = execution as Record<string, unknown>;

  if (record["kind"] === "agent_turn") {
    const instruction =
      typeof record["instruction"] === "string" && record["instruction"].trim().length > 0
        ? record["instruction"].trim()
        : undefined;
    return { kind: "agent_turn", ...(instruction ? { instruction } : undefined) };
  }

  if (record["kind"] === "playbook") {
    const playbookId =
      typeof record["playbook_id"] === "string" ? record["playbook_id"].trim() : "";
    if (!playbookId) return undefined;
    return { kind: "playbook", playbook_id: playbookId };
  }

  if (record["kind"] === "steps") {
    const steps = record["steps"];
    if (!Array.isArray(steps) || steps.length === 0) return undefined;
    const parsedSteps: ActionPrimitive[] = [];
    for (const step of steps) {
      const parsedStep = ActionPrimitiveSchema.safeParse(step);
      if (!parsedStep.success) {
        throw new Error(`invalid steps schedule action: ${parsedStep.error.message}`);
      }
      parsedSteps.push(parsedStep.data);
    }
    return { kind: "steps", steps: parsedSteps };
  }

  return undefined;
}

async function executeAutomationScheduleList(
  context: ScheduleExecutorContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const service = getScheduleService(context);
  const scope = await resolveScheduleScope(args, context);
  const parsed = args as Record<string, unknown> | null;
  const schedules = await service.listSchedules({
    tenantId: scope.tenantId,
    agentKey: scope.agentKey,
    workspaceKey: scope.workspaceKey,
    includeDeleted: parsed?.["include_deleted"] === true,
  });
  return { tool_call_id: toolCallId, output: JSON.stringify({ schedules }) };
}

async function executeAutomationScheduleGet(
  context: ScheduleExecutorContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const service = getScheduleService(context);
  const parsed = args as Record<string, unknown> | null;
  const scheduleId =
    typeof parsed?.["schedule_id"] === "string" ? parsed["schedule_id"].trim() : "";
  if (!scheduleId) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "missing required argument: schedule_id",
    };
  }

  const schedule = await service.getSchedule({
    tenantId: context.workspaceLease?.tenantId ?? DEFAULT_TENANT_ID,
    scheduleId,
    includeDeleted: parsed?.["include_deleted"] === true,
  });
  return { tool_call_id: toolCallId, output: JSON.stringify({ schedule: schedule ?? null }) };
}

async function executeAutomationScheduleCreate(
  context: ScheduleExecutorContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const service = getScheduleService(context);
  const parsed = args as Record<string, unknown> | null;
  const kind =
    parsed?.["kind"] === "heartbeat" || parsed?.["kind"] === "cron"
      ? (parsed["kind"] as ScheduleKind)
      : undefined;
  const cadence = parseScheduleCadence(parsed);
  const execution = parseScheduleExecution(parsed);
  if (!kind || !cadence || !execution) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "kind, cadence, and execution are required",
    };
  }

  const scope = await resolveScheduleScope(args, context);
  const schedule = await service.createSchedule({
    tenantId: scope.tenantId,
    agentKey: scope.agentKey,
    workspaceKey: scope.workspaceKey,
    kind,
    enabled: parsed?.["enabled"] !== false,
    cadence,
    execution,
    delivery:
      parsed?.["delivery"] && typeof parsed["delivery"] === "object"
        ? {
            mode:
              (parsed["delivery"] as Record<string, unknown>)["mode"] === "notify"
                ? "notify"
                : (parsed["delivery"] as Record<string, unknown>)["mode"] === "quiet"
                  ? "quiet"
                  : undefined,
          }
        : undefined,
  });
  return { tool_call_id: toolCallId, output: JSON.stringify({ schedule }) };
}

async function executeAutomationScheduleUpdate(
  context: ScheduleExecutorContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const service = getScheduleService(context);
  const parsed = args as Record<string, unknown> | null;
  const scheduleId =
    typeof parsed?.["schedule_id"] === "string" ? parsed["schedule_id"].trim() : "";
  if (!scheduleId) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "missing required argument: schedule_id",
    };
  }

  const patch: {
    enabled?: boolean;
    kind?: ScheduleKind;
    cadence?: ScheduleCadence;
    execution?: ScheduleExecution;
    delivery?: { mode?: "quiet" | "notify" };
  } = {};
  if (parsed?.["enabled"] === true || parsed?.["enabled"] === false) {
    patch.enabled = parsed["enabled"] as boolean;
  }
  if (parsed?.["kind"] === "heartbeat" || parsed?.["kind"] === "cron") {
    patch.kind = parsed["kind"] as ScheduleKind;
  }

  const cadence = parseScheduleCadence(parsed);
  if (cadence) patch.cadence = cadence;

  const execution = parseScheduleExecution(parsed);
  if (execution) patch.execution = execution;

  if (parsed?.["delivery"] && typeof parsed["delivery"] === "object") {
    const mode = (parsed["delivery"] as Record<string, unknown>)["mode"];
    if (mode === "quiet" || mode === "notify") {
      patch.delivery = { mode };
    }
  }

  const schedule = await service.updateSchedule({
    tenantId: context.workspaceLease?.tenantId ?? DEFAULT_TENANT_ID,
    scheduleId,
    patch,
  });
  return { tool_call_id: toolCallId, output: JSON.stringify({ schedule }) };
}

async function executeScheduleToggle(
  context: ScheduleExecutorContext,
  toolCallId: string,
  args: unknown,
  mode: "pause" | "resume",
): Promise<ToolResult> {
  const service = getScheduleService(context);
  const parsed = args as Record<string, unknown> | null;
  const scheduleId =
    typeof parsed?.["schedule_id"] === "string" ? parsed["schedule_id"].trim() : "";
  if (!scheduleId) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "missing required argument: schedule_id",
    };
  }

  const schedule =
    mode === "pause"
      ? await service.pauseSchedule({
          tenantId: context.workspaceLease?.tenantId ?? DEFAULT_TENANT_ID,
          scheduleId,
        })
      : await service.resumeSchedule({
          tenantId: context.workspaceLease?.tenantId ?? DEFAULT_TENANT_ID,
          scheduleId,
        });

  return { tool_call_id: toolCallId, output: JSON.stringify({ schedule }) };
}

async function executeAutomationScheduleDelete(
  context: ScheduleExecutorContext,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult> {
  const service = getScheduleService(context);
  const parsed = args as Record<string, unknown> | null;
  const scheduleId =
    typeof parsed?.["schedule_id"] === "string" ? parsed["schedule_id"].trim() : "";
  if (!scheduleId) {
    return {
      tool_call_id: toolCallId,
      output: "",
      error: "missing required argument: schedule_id",
    };
  }

  await service.deleteSchedule({
    tenantId: context.workspaceLease?.tenantId ?? DEFAULT_TENANT_ID,
    scheduleId,
  });
  return {
    tool_call_id: toolCallId,
    output: JSON.stringify({ schedule_id: scheduleId, deleted: true }),
  };
}

export async function executeAutomationScheduleTool(
  context: ScheduleExecutorContext,
  toolId: string,
  toolCallId: string,
  args: unknown,
): Promise<ToolResult | null> {
  switch (toolId) {
    case "tool.automation.schedule.list":
      return await executeAutomationScheduleList(context, toolCallId, args);
    case "tool.automation.schedule.get":
      return await executeAutomationScheduleGet(context, toolCallId, args);
    case "tool.automation.schedule.create":
      return await executeAutomationScheduleCreate(context, toolCallId, args);
    case "tool.automation.schedule.update":
      return await executeAutomationScheduleUpdate(context, toolCallId, args);
    case "tool.automation.schedule.pause":
      return await executeScheduleToggle(context, toolCallId, args, "pause");
    case "tool.automation.schedule.resume":
      return await executeScheduleToggle(context, toolCallId, args, "resume");
    case "tool.automation.schedule.delete":
      return await executeAutomationScheduleDelete(context, toolCallId, args);
    default:
      return null;
  }
}
