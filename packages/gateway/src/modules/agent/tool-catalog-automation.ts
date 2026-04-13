import type { ToolDescriptor } from "./tools.js";
import {
  AUTOMATION_SCHEDULE_CREATE_PROMPT_METADATA,
  AUTOMATION_SCHEDULE_UPDATE_PROMPT_METADATA,
} from "./tool-catalog-prompt-metadata.js";

const AUTOMATION_SCHEDULE_FAMILY = "tool.automation.schedule";

export const AUTOMATION_TOOL_REGISTRY: readonly ToolDescriptor[] = [
  {
    id: "tool.automation.schedule.list",
    description: "List automation schedules for the current or specified agent/workspace scope.",
    effect: "read_only",
    keywords: ["automation", "schedule", "heartbeat", "cron", "list"],
    source: "builtin",
    family: AUTOMATION_SCHEDULE_FAMILY,
    inputSchema: {
      type: "object",
      properties: {
        agent_key: { type: "string" },
        workspace_key: { type: "string" },
        include_deleted: { type: "boolean" },
      },
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.get",
    description: "Fetch a single automation schedule by id.",
    effect: "read_only",
    keywords: ["automation", "schedule", "heartbeat", "cron", "get"],
    source: "builtin",
    family: AUTOMATION_SCHEDULE_FAMILY,
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
        include_deleted: { type: "boolean" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.create",
    description: "Create a recurring automation schedule such as a heartbeat or cron job.",
    effect: "state_changing",
    keywords: ["automation", "schedule", "heartbeat", "cron", "create"],
    ...AUTOMATION_SCHEDULE_CREATE_PROMPT_METADATA,
    source: "builtin",
    family: AUTOMATION_SCHEDULE_FAMILY,
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["heartbeat", "cron"] },
        enabled: { type: "boolean" },
        agent_key: { type: "string" },
        workspace_key: { type: "string" },
        cadence: {
          type: "object",
          description:
            "Either {type:'interval', interval_ms} or {type:'cron', expression, timezone}.",
        },
        execution: {
          type: "object",
          description: "Either agent_turn, playbook, or steps execution.",
        },
        delivery: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["quiet", "notify"] },
          },
          additionalProperties: false,
        },
      },
      required: ["kind", "cadence", "execution"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.update",
    description: "Update an existing automation schedule.",
    effect: "state_changing",
    keywords: ["automation", "schedule", "heartbeat", "cron", "update"],
    ...AUTOMATION_SCHEDULE_UPDATE_PROMPT_METADATA,
    source: "builtin",
    family: AUTOMATION_SCHEDULE_FAMILY,
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
        kind: { type: "string", enum: ["heartbeat", "cron"] },
        enabled: { type: "boolean" },
        cadence: { type: "object" },
        execution: { type: "object" },
        delivery: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["quiet", "notify"] },
          },
          additionalProperties: false,
        },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.pause",
    description: "Pause an automation schedule without deleting it.",
    effect: "state_changing",
    keywords: ["automation", "schedule", "pause", "disable"],
    source: "builtin",
    family: AUTOMATION_SCHEDULE_FAMILY,
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.resume",
    description: "Resume a paused automation schedule.",
    effect: "state_changing",
    keywords: ["automation", "schedule", "resume", "enable"],
    source: "builtin",
    family: AUTOMATION_SCHEDULE_FAMILY,
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
  {
    id: "tool.automation.schedule.delete",
    description: "Delete an automation schedule.",
    effect: "state_changing",
    keywords: ["automation", "schedule", "delete", "remove"],
    source: "builtin",
    family: AUTOMATION_SCHEDULE_FAMILY,
    inputSchema: {
      type: "object",
      properties: {
        schedule_id: { type: "string" },
      },
      required: ["schedule_id"],
      additionalProperties: false,
    },
  },
];
