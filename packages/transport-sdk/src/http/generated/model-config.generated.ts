// GENERATED: pnpm api:generate

import type { ModelConfigApi } from "../model-config.js";
import {
  ConfiguredAvailableModelListResponse,
  ConfiguredModelPresetCreateRequest,
  ConfiguredModelPresetListResponse,
  ConfiguredModelPresetMutateResponse,
  ConfiguredModelPresetUpdateRequest,
  ExecutionProfileModelAssignmentListResponse,
  ExecutionProfileModelAssignmentUpdateRequest,
  ExecutionProfileModelAssignmentUpdateResponse,
  ModelConfigDeleteRequest,
} from "@tyrum/contracts";
import { HttpTransport, NonEmptyString, validateOrThrow } from "../shared.js";
import { parseModelConfigDeleteResponse } from "../config-delete-response.js";

const PresetPathKey = NonEmptyString;
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
      return await parseModelConfigDeleteResponse(response, {
        conflictContext: "model preset delete conflict response",
        responseContext: "model preset delete response",
      });
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
