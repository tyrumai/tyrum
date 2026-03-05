import {
  ConfiguredAvailableModelListResponse,
  ConfiguredModelPresetCreateRequest,
  ConfiguredModelPresetListResponse,
  ConfiguredModelPresetMutateResponse,
  ConfiguredModelPresetUpdateRequest,
  ExecutionProfileModelAssignmentListResponse,
  ExecutionProfileModelAssignmentUpdateRequest,
  ExecutionProfileModelAssignmentUpdateResponse,
  ModelConfigDeleteConflictResponse,
  ModelConfigDeleteRequest,
  ModelConfigDeleteResponse,
} from "@tyrum/schemas";
import { z } from "zod";
import {
  HttpTransport,
  NonEmptyString,
  validateOrThrow,
  type TyrumRequestOptions,
} from "./shared.js";

const PresetPathKey = NonEmptyString;

export type ConfiguredModelPresetListResult = z.output<typeof ConfiguredModelPresetListResponse>;
export type ConfiguredAvailableModelListResult = z.output<
  typeof ConfiguredAvailableModelListResponse
>;
export type ConfiguredModelPresetCreateInput = z.input<typeof ConfiguredModelPresetCreateRequest>;
export type ConfiguredModelPresetUpdateInput = z.input<typeof ConfiguredModelPresetUpdateRequest>;
export type ExecutionProfileAssignmentUpdateInput = z.input<
  typeof ExecutionProfileModelAssignmentUpdateRequest
>;
export type ModelPresetDeleteInput = z.input<typeof ModelConfigDeleteRequest>;
export type ModelPresetDeleteResult =
  | z.output<typeof ModelConfigDeleteResponse>
  | z.output<typeof ModelConfigDeleteConflictResponse>;

async function parseDeleteResponse(response: Response): Promise<ModelPresetDeleteResult> {
  const body = (await response.json().catch(() => undefined)) as unknown;
  if (response.status === 409) {
    return validateOrThrow(
      ModelConfigDeleteConflictResponse,
      body,
      "model preset delete conflict response",
    );
  }
  return validateOrThrow(ModelConfigDeleteResponse, body, "model preset delete response");
}

export interface ModelConfigApi {
  listPresets(options?: TyrumRequestOptions): Promise<ConfiguredModelPresetListResult>;
  listAvailable(options?: TyrumRequestOptions): Promise<ConfiguredAvailableModelListResult>;
  createPreset(
    input: ConfiguredModelPresetCreateInput,
    options?: TyrumRequestOptions,
  ): Promise<z.output<typeof ConfiguredModelPresetMutateResponse>>;
  updatePreset(
    presetKey: string,
    input: ConfiguredModelPresetUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<z.output<typeof ConfiguredModelPresetMutateResponse>>;
  deletePreset(
    presetKey: string,
    input?: ModelPresetDeleteInput,
    options?: TyrumRequestOptions,
  ): Promise<ModelPresetDeleteResult>;
  listAssignments(
    options?: TyrumRequestOptions,
  ): Promise<z.output<typeof ExecutionProfileModelAssignmentListResponse>>;
  updateAssignments(
    input: ExecutionProfileAssignmentUpdateInput,
    options?: TyrumRequestOptions,
  ): Promise<z.output<typeof ExecutionProfileModelAssignmentUpdateResponse>>;
}

export function createModelConfigApi(transport: HttpTransport): ModelConfigApi {
  return {
    async listPresets(options) {
      return await transport.request({
        method: "GET",
        path: "/config/models/presets",
        response: ConfiguredModelPresetListResponse,
        signal: options?.signal,
      });
    },

    async listAvailable(options) {
      return await transport.request({
        method: "GET",
        path: "/config/models/presets/available",
        response: ConfiguredAvailableModelListResponse,
        signal: options?.signal,
      });
    },

    async createPreset(input, options) {
      const body = validateOrThrow(
        ConfiguredModelPresetCreateRequest,
        input,
        "model preset create request",
      );
      return await transport.request({
        method: "POST",
        path: "/config/models/presets",
        body,
        response: ConfiguredModelPresetMutateResponse,
        expectedStatus: 201,
        signal: options?.signal,
      });
    },

    async updatePreset(presetKey, input, options) {
      const parsedPresetKey = validateOrThrow(PresetPathKey, presetKey, "model preset key");
      const body = validateOrThrow(
        ConfiguredModelPresetUpdateRequest,
        input,
        "model preset update request",
      );
      return await transport.request({
        method: "PATCH",
        path: `/config/models/presets/${encodeURIComponent(parsedPresetKey)}`,
        body,
        response: ConfiguredModelPresetMutateResponse,
        signal: options?.signal,
      });
    },

    async deletePreset(presetKey, input, options) {
      const parsedPresetKey = validateOrThrow(PresetPathKey, presetKey, "model preset key");
      const body = input
        ? validateOrThrow(ModelConfigDeleteRequest, input, "model preset delete request")
        : undefined;
      const response = await transport.requestRaw({
        method: "DELETE",
        path: `/config/models/presets/${encodeURIComponent(parsedPresetKey)}`,
        body,
        expectedStatus: [200, 409],
        signal: options?.signal,
      });
      return await parseDeleteResponse(response);
    },

    async listAssignments(options) {
      return await transport.request({
        method: "GET",
        path: "/config/models/assignments",
        response: ExecutionProfileModelAssignmentListResponse,
        signal: options?.signal,
      });
    },

    async updateAssignments(input, options) {
      const body = validateOrThrow(
        ExecutionProfileModelAssignmentUpdateRequest,
        input,
        "model assignment update request",
      );
      return await transport.request({
        method: "PUT",
        path: "/config/models/assignments",
        body,
        response: ExecutionProfileModelAssignmentUpdateResponse,
        signal: options?.signal,
      });
    },
  };
}
