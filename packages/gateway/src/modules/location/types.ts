import { z } from "zod";
import {
  ActionPrimitive,
  LocationEventTransition,
  LocationPlaceId,
  WorkspaceKey,
} from "@tyrum/schemas";

export const LocationTriggerCondition = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("saved_place"),
      place_id: LocationPlaceId,
      transition: LocationEventTransition,
    })
    .strict(),
  z
    .object({
      type: z.literal("poi_category"),
      category_key: z.string().trim().min(1),
      transition: LocationEventTransition,
    })
    .strict(),
]);
export type LocationTriggerCondition = z.infer<typeof LocationTriggerCondition>;

export const LocationTriggerExecution = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("agent_turn"),
      instruction: z.string().trim().min(1).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("steps"),
      steps: z.array(ActionPrimitive).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("playbook"),
      playbook_id: z.string().trim().min(1),
    })
    .strict(),
]);
export type LocationTriggerExecution = z.infer<typeof LocationTriggerExecution>;

export const LocationAutomationTriggerRecord = z
  .object({
    trigger_id: z.string().uuid(),
    agent_key: z.string().trim().min(1),
    workspace_key: WorkspaceKey,
    enabled: z.boolean(),
    delivery_mode: z.enum(["quiet", "notify"]),
    trigger_type: z.literal("location"),
    condition: LocationTriggerCondition,
    execution: LocationTriggerExecution,
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();
export type LocationAutomationTriggerRecord = z.infer<typeof LocationAutomationTriggerRecord>;

export const LocationAutomationTriggerCreateRequest = z
  .object({
    agent_key: z.string().trim().min(1).optional(),
    workspace_key: WorkspaceKey.optional(),
    enabled: z.boolean().default(true),
    delivery_mode: z.enum(["quiet", "notify"]).default("notify"),
    condition: LocationTriggerCondition,
    execution: LocationTriggerExecution,
  })
  .strict();
export type LocationAutomationTriggerCreateRequest = z.infer<
  typeof LocationAutomationTriggerCreateRequest
>;

export const LocationAutomationTriggerPatchRequest = z
  .object({
    enabled: z.boolean().optional(),
    delivery_mode: z.enum(["quiet", "notify"]).optional(),
    condition: LocationTriggerCondition.optional(),
    execution: LocationTriggerExecution.optional(),
  })
  .strict();
export type LocationAutomationTriggerPatchRequest = z.infer<
  typeof LocationAutomationTriggerPatchRequest
>;
