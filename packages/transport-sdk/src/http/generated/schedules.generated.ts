// GENERATED: pnpm api:generate

import type { SchedulesApi } from "../schedules.js";
import { HttpTransport, NonEmptyString, validateOrThrow } from "../shared.js";
import {
  ScheduleDeleteResponse,
  ScheduleListResponse,
  ScheduleSingleResponse,
} from "@tyrum/contracts";
import { z } from "zod";

const scheduleIdSchema = NonEmptyString;
const listQuerySchema = z
  .object({
    agent_key: z.string().trim().min(1).optional(),
    workspace_key: z.string().trim().min(1).optional(),
    include_deleted: z.boolean().optional(),
  })
  .strict()
  .optional();
const createInputSchema = z
  .object({
    kind: z.enum(["heartbeat", "cron"]),
    agent_key: z.string().trim().min(1).optional(),
    workspace_key: z.string().trim().min(1).optional(),
    enabled: z.boolean().optional(),
    cadence: z.unknown(),
    execution: z.unknown(),
    delivery: z
      .object({ mode: z.enum(["quiet", "notify"]) })
      .strict()
      .optional(),
  })
  .strict();
const updateInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    kind: z.enum(["heartbeat", "cron"]).optional(),
    cadence: z.unknown().optional(),
    execution: z.unknown().optional(),
    delivery: z
      .object({ mode: z.enum(["quiet", "notify"]) })
      .strict()
      .optional(),
  })
  .strict();
export function createSchedulesApi(transport: HttpTransport): SchedulesApi {
  return {
    async list(query, options) {
      const parsed = validateOrThrow(listQuerySchema, query, "schedule list query");
      return await transport.request({
        method: "GET",
        path: "/automation/schedules",
        query: parsed
          ? {
              agent_key: parsed.agent_key,
              workspace_key: parsed.workspace_key,
              include_deleted: parsed.include_deleted ? "true" : undefined,
            }
          : undefined,
        response: ScheduleListResponse,
        signal: options?.signal,
      });
    },

    async get(id, options) {
      const parsedId = validateOrThrow(scheduleIdSchema, id, "schedule id");
      return await transport.request({
        method: "GET",
        path: `/automation/schedules/${encodeURIComponent(parsedId)}`,
        response: ScheduleSingleResponse,
        signal: options?.signal,
      });
    },

    async create(input, options) {
      const payload = validateOrThrow(createInputSchema, input, "schedule create input");
      return await transport.request({
        method: "POST",
        path: "/automation/schedules",
        body: payload,
        response: ScheduleSingleResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },

    async update(id, input, options) {
      const parsedId = validateOrThrow(scheduleIdSchema, id, "schedule id");
      const payload = validateOrThrow(updateInputSchema, input, "schedule update input");
      return await transport.request({
        method: "PATCH",
        path: `/automation/schedules/${encodeURIComponent(parsedId)}`,
        body: payload,
        response: ScheduleSingleResponse,
        signal: options?.signal,
      });
    },

    async pause(id, options) {
      const parsedId = validateOrThrow(scheduleIdSchema, id, "schedule id");
      return await transport.request({
        method: "POST",
        path: `/automation/schedules/${encodeURIComponent(parsedId)}/pause`,
        body: {},
        response: ScheduleSingleResponse,
        signal: options?.signal,
      });
    },

    async resume(id, options) {
      const parsedId = validateOrThrow(scheduleIdSchema, id, "schedule id");
      return await transport.request({
        method: "POST",
        path: `/automation/schedules/${encodeURIComponent(parsedId)}/resume`,
        body: {},
        response: ScheduleSingleResponse,
        signal: options?.signal,
      });
    },

    async remove(id, options) {
      const parsedId = validateOrThrow(scheduleIdSchema, id, "schedule id");
      return await transport.request({
        method: "DELETE",
        path: `/automation/schedules/${encodeURIComponent(parsedId)}`,
        response: ScheduleDeleteResponse,
        signal: options?.signal,
      });
    },
  };
}
