import { z } from "zod";
import { DateTimeSchema, UuidSchema } from "./common.js";

const JsonRecord = z.record(z.string().trim().min(1), z.unknown());
const NonEmptyString = z.string().trim().min(1);
const NullableNonEmptyString = NonEmptyString.nullable();

export const ConfiguredExecutionProfileId = z.enum([
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
]);
export type ConfiguredExecutionProfileId = z.infer<typeof ConfiguredExecutionProfileId>;

export const ConfiguredModelPresetOptionSet = z
  .object({
    reasoning_effort: z.enum(["low", "medium", "high"]).optional(),
    reasoning_visibility: z.enum(["hidden", "collapsed", "expanded"]).optional(),
  })
  .strict();
export type ConfiguredModelPresetOptionSet = z.infer<typeof ConfiguredModelPresetOptionSet>;

export const ConfiguredModelPreset = z
  .object({
    preset_id: UuidSchema,
    preset_key: NonEmptyString,
    display_name: NonEmptyString,
    provider_key: NonEmptyString,
    model_id: NonEmptyString,
    options: ConfiguredModelPresetOptionSet.default({}),
    created_at: DateTimeSchema,
    updated_at: DateTimeSchema,
  })
  .strict();
export type ConfiguredModelPreset = z.infer<typeof ConfiguredModelPreset>;

export const ConfiguredModelPresetListResponse = z
  .object({
    status: z.literal("ok"),
    presets: z.array(ConfiguredModelPreset),
  })
  .strict();
export type ConfiguredModelPresetListResponse = z.infer<typeof ConfiguredModelPresetListResponse>;

export const ConfiguredModelPresetCreateRequest = z
  .object({
    display_name: NonEmptyString,
    provider_key: NonEmptyString,
    model_id: NonEmptyString,
    options: ConfiguredModelPresetOptionSet.default({}),
  })
  .strict();
export type ConfiguredModelPresetCreateRequest = z.infer<typeof ConfiguredModelPresetCreateRequest>;

export const ConfiguredModelPresetUpdateRequest = z
  .object({
    display_name: NonEmptyString.optional(),
    options: ConfiguredModelPresetOptionSet.optional(),
  })
  .strict();
export type ConfiguredModelPresetUpdateRequest = z.infer<typeof ConfiguredModelPresetUpdateRequest>;

export const ConfiguredModelPresetMutateResponse = z
  .object({
    status: z.literal("ok"),
    preset: ConfiguredModelPreset,
  })
  .strict();
export type ConfiguredModelPresetMutateResponse = z.infer<
  typeof ConfiguredModelPresetMutateResponse
>;

export const ConfiguredAvailableModel = z
  .object({
    provider_key: NonEmptyString,
    provider_name: NonEmptyString,
    model_id: NonEmptyString,
    model_name: NonEmptyString,
    family: NonEmptyString.nullable().default(null),
    reasoning: z.boolean().nullable().default(null),
    tool_call: z.boolean().nullable().default(null),
    modalities: JsonRecord.nullable().default(null),
  })
  .strict();
export type ConfiguredAvailableModel = z.infer<typeof ConfiguredAvailableModel>;

export const ConfiguredAvailableModelListResponse = z
  .object({
    status: z.literal("ok"),
    models: z.array(ConfiguredAvailableModel),
  })
  .strict();
export type ConfiguredAvailableModelListResponse = z.infer<
  typeof ConfiguredAvailableModelListResponse
>;

export const ExecutionProfileModelAssignment = z
  .object({
    execution_profile_id: ConfiguredExecutionProfileId,
    preset_key: NullableNonEmptyString,
    preset_display_name: NullableNonEmptyString,
    provider_key: NullableNonEmptyString,
    model_id: NullableNonEmptyString,
  })
  .strict();
export type ExecutionProfileModelAssignment = z.infer<typeof ExecutionProfileModelAssignment>;

export const ExecutionProfileModelAssignmentListResponse = z
  .object({
    status: z.literal("ok"),
    assignments: z.array(ExecutionProfileModelAssignment),
  })
  .strict();
export type ExecutionProfileModelAssignmentListResponse = z.infer<
  typeof ExecutionProfileModelAssignmentListResponse
>;

export const ExecutionProfileModelAssignmentUpdateRequest = z
  .object({
    assignments: z.record(NonEmptyString, NullableNonEmptyString),
  })
  .strict();
export type ExecutionProfileModelAssignmentUpdateRequest = z.infer<
  typeof ExecutionProfileModelAssignmentUpdateRequest
>;

export const ExecutionProfileModelAssignmentUpdateResponse =
  ExecutionProfileModelAssignmentListResponse;
export type ExecutionProfileModelAssignmentUpdateResponse = z.infer<
  typeof ExecutionProfileModelAssignmentUpdateResponse
>;

export const ModelConfigDeleteRequest = z
  .object({
    replacement_assignments: z.record(NonEmptyString, NullableNonEmptyString).optional(),
  })
  .strict();
export type ModelConfigDeleteRequest = z.infer<typeof ModelConfigDeleteRequest>;

export const ModelConfigDeleteConflictResponse = z
  .object({
    error: z.literal("assignment_required"),
    message: NonEmptyString,
    required_execution_profile_ids: z.array(ConfiguredExecutionProfileId),
  })
  .strict();
export type ModelConfigDeleteConflictResponse = z.infer<typeof ModelConfigDeleteConflictResponse>;

export const ModelConfigDeleteResponse = z
  .object({
    status: z.literal("ok"),
  })
  .strict();
export type ModelConfigDeleteResponse = z.infer<typeof ModelConfigDeleteResponse>;
