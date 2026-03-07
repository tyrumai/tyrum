import {
  ActionPrimitive as ActionPrimitiveSchema,
  UuidSchema,
  type ActionPrimitive,
} from "@tyrum/schemas";
import { Hono } from "hono";
import { DEFAULT_TENANT_ID } from "../modules/identity/scope.js";
import {
  ScheduleService,
  type ScheduleCadence,
  type ScheduleExecution,
  type ScheduleKind,
} from "../modules/automation/schedule-service.js";
import type { GatewayContainer } from "../container.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseScheduleId(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  const parsed = UuidSchema.safeParse(trimmed);
  return parsed.success ? parsed.data : undefined;
}

function parseCadence(raw: unknown): ScheduleCadence | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw["type"] === "interval") {
    const intervalMs = raw["interval_ms"];
    if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      return undefined;
    }
    return { type: "interval", interval_ms: Math.floor(intervalMs) };
  }
  if (raw["type"] === "cron") {
    const expression = typeof raw["expression"] === "string" ? raw["expression"].trim() : "";
    const timezone = typeof raw["timezone"] === "string" ? raw["timezone"].trim() : "";
    if (!expression || !timezone) return undefined;
    return { type: "cron", expression, timezone };
  }
  return undefined;
}

function parseActionSteps(raw: unknown): ActionPrimitive[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const steps: ActionPrimitive[] = [];
  for (const step of raw) {
    const parsed = ActionPrimitiveSchema.safeParse(step);
    if (!parsed.success) {
      throw new Error(`invalid steps schedule action: ${parsed.error.message}`);
    }
    steps.push(parsed.data);
  }
  return steps;
}

function parseExecution(raw: unknown): ScheduleExecution | undefined {
  if (!isRecord(raw)) return undefined;
  const kind = raw["kind"];
  if (kind === "agent_turn") {
    const instruction =
      typeof raw["instruction"] === "string" && raw["instruction"].trim().length > 0
        ? raw["instruction"].trim()
        : undefined;
    return { kind, ...(instruction ? { instruction } : undefined) };
  }
  if (kind === "playbook") {
    const playbookId = typeof raw["playbook_id"] === "string" ? raw["playbook_id"].trim() : "";
    if (!playbookId) return undefined;
    return { kind, playbook_id: playbookId };
  }
  if (kind === "steps") {
    const steps = parseActionSteps(raw["steps"]);
    if (!steps) return undefined;
    return { kind, steps };
  }
  return undefined;
}

export function createAutomationScheduleRoutes(container: GatewayContainer): Hono {
  const app = new Hono();
  const service = new ScheduleService(container.db, container.identityScopeDal);

  app.get("/automation/schedules", async (c) => {
    const agentKey = c.req.query("agent_key")?.trim() || undefined;
    const workspaceKey = c.req.query("workspace_key")?.trim() || undefined;
    const includeDeleted = c.req.query("include_deleted") === "true";
    const schedules = await service.listSchedules({
      tenantId: DEFAULT_TENANT_ID,
      agentKey,
      workspaceKey,
      includeDeleted,
    });
    return c.json({ schedules });
  });

  app.get("/automation/schedules/:id", async (c) => {
    const scheduleId = parseScheduleId(c.req.param("id"));
    if (!scheduleId) {
      return c.json({ error: "invalid_request", message: "invalid schedule id" }, 400);
    }
    const schedule = await service.getSchedule({
      tenantId: DEFAULT_TENANT_ID,
      scheduleId,
      includeDeleted: c.req.query("include_deleted") === "true",
    });
    if (!schedule) {
      return c.json({ error: "not_found", message: "schedule not found" }, 404);
    }
    return c.json({ schedule });
  });

  app.post("/automation/schedules", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;

    try {
      const kind = body["kind"];
      const cadence = parseCadence(body["cadence"]);
      const execution = parseExecution(body["execution"]);
      if ((kind !== "heartbeat" && kind !== "cron") || !cadence || !execution) {
        return c.json(
          {
            error: "invalid_request",
            message: "kind, cadence, and execution are required",
          },
          400,
        );
      }

      const schedule = await service.createSchedule({
        tenantId: DEFAULT_TENANT_ID,
        agentKey: typeof body["agent_key"] === "string" ? body["agent_key"] : undefined,
        workspaceKey: typeof body["workspace_key"] === "string" ? body["workspace_key"] : undefined,
        kind: kind as ScheduleKind,
        enabled: body["enabled"] !== false,
        cadence,
        execution,
        delivery: {
          mode:
            isRecord(body["delivery"]) && body["delivery"]["mode"] === "notify"
              ? "notify"
              : isRecord(body["delivery"]) && body["delivery"]["mode"] === "quiet"
                ? "quiet"
                : undefined,
        },
      });
      return c.json({ schedule }, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: "invalid_request", message }, 400);
    }
  });

  app.patch("/automation/schedules/:id", async (c) => {
    const scheduleId = parseScheduleId(c.req.param("id"));
    if (!scheduleId) {
      return c.json({ error: "invalid_request", message: "invalid schedule id" }, 400);
    }
    const body = (await c.req.json()) as Record<string, unknown>;
    const patch: {
      enabled?: boolean;
      kind?: ScheduleKind;
      cadence?: ScheduleCadence;
      execution?: ScheduleExecution;
      delivery?: { mode?: "quiet" | "notify" };
    } = {};
    if (body["enabled"] === true || body["enabled"] === false) {
      patch.enabled = body["enabled"] as boolean;
    }
    if (body["kind"] === "heartbeat" || body["kind"] === "cron") {
      patch.kind = body["kind"] as ScheduleKind;
    }

    try {
      const cadence = parseCadence(body["cadence"]);
      if (cadence) patch.cadence = cadence;
      const execution = parseExecution(body["execution"]);
      if (execution) patch.execution = execution;
      if (isRecord(body["delivery"])) {
        const mode = body["delivery"]["mode"];
        if (mode === "quiet" || mode === "notify") {
          patch.delivery = { mode };
        }
      }

      const schedule = await service.updateSchedule({
        tenantId: DEFAULT_TENANT_ID,
        scheduleId,
        patch,
      });
      return c.json({ schedule });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404 : 400;
      return c.json({ error: status === 404 ? "not_found" : "invalid_request", message }, status);
    }
  });

  app.post("/automation/schedules/:id/pause", async (c) => {
    const scheduleId = parseScheduleId(c.req.param("id"));
    if (!scheduleId) {
      return c.json({ error: "invalid_request", message: "invalid schedule id" }, 400);
    }
    try {
      const schedule = await service.pauseSchedule({
        tenantId: DEFAULT_TENANT_ID,
        scheduleId,
      });
      return c.json({ schedule });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404 : 400;
      return c.json({ error: status === 404 ? "not_found" : "invalid_request", message }, status);
    }
  });

  app.post("/automation/schedules/:id/resume", async (c) => {
    const scheduleId = parseScheduleId(c.req.param("id"));
    if (!scheduleId) {
      return c.json({ error: "invalid_request", message: "invalid schedule id" }, 400);
    }
    try {
      const schedule = await service.resumeSchedule({
        tenantId: DEFAULT_TENANT_ID,
        scheduleId,
      });
      return c.json({ schedule });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404 : 400;
      return c.json({ error: status === 404 ? "not_found" : "invalid_request", message }, status);
    }
  });

  app.delete("/automation/schedules/:id", async (c) => {
    const scheduleId = parseScheduleId(c.req.param("id"));
    if (!scheduleId) {
      return c.json({ error: "invalid_request", message: "invalid schedule id" }, 400);
    }
    try {
      await service.deleteSchedule({ tenantId: DEFAULT_TENANT_ID, scheduleId });
      return c.json({ schedule_id: scheduleId, deleted: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes("not found") ? 404 : 400;
      return c.json({ error: status === 404 ? "not_found" : "invalid_request", message }, status);
    }
  });

  return app;
}
