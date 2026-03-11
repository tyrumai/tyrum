import { expect, vi } from "vitest";
import type { OperatorCore } from "../../../operator-core/src/index.js";

export const TEST_TIMESTAMP = "2026-03-01T00:00:00.000Z";
export const ADMIN_HTTP_EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;

export type ExecutionProfileId = (typeof ADMIN_HTTP_EXECUTION_PROFILE_IDS)[number];

export type ModelPresetFixture = {
  preset_id: string;
  preset_key: string;
  display_name: string;
  provider_key: string;
  model_id: string;
  options: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AvailableModelFixture = {
  provider_key: string;
  provider_name: string;
  model_id: string;
  model_name: string;
  family: string | null;
  reasoning: boolean;
  tool_call: boolean;
  modalities: { output: string[] };
};

export type ModelAssignmentFixture = {
  execution_profile_id: string;
  preset_key: string;
  preset_display_name: string;
  provider_key: string;
  model_id: string;
};

type ModelConfigMocks = {
  listPresets: ReturnType<typeof vi.fn>;
  listAvailable: ReturnType<typeof vi.fn>;
  listAssignments: ReturnType<typeof vi.fn>;
};

type ModelsFetchStubInput = {
  presets: ModelPresetFixture[] | (() => ModelPresetFixture[]);
  models: AvailableModelFixture[] | (() => AvailableModelFixture[]);
  assignments: ModelAssignmentFixture[] | (() => ModelAssignmentFixture[]);
  createPreset?: {
    expectedBody: unknown;
    responsePreset: ModelPresetFixture;
    afterCreate?: () => void;
  };
  updatePreset?: {
    presetKey: string;
    expectedBody: unknown;
    responsePreset: ModelPresetFixture | (() => ModelPresetFixture);
    afterUpdate?: () => void;
  };
  updateAssignments?: {
    expectedBody: unknown;
    responseAssignments: ModelAssignmentFixture[] | (() => ModelAssignmentFixture[]);
    afterUpdate?: () => void;
  };
  deletePreset?: {
    presetKey: string;
    handle: (body: unknown, attempt: number) => Response | Promise<Response>;
  };
};

function resolveValue<T>(value: T | (() => T)): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

export function getModelConfig(core: OperatorCore): ModelConfigMocks {
  return core.http.modelConfig as ModelConfigMocks;
}

export function setModelConfigResponses(
  core: OperatorCore,
  input: {
    presets?: ModelPresetFixture[];
    models?: AvailableModelFixture[];
    assignments?: ModelAssignmentFixture[];
    listAvailableError?: Error;
    listAssignmentsError?: Error;
  },
): ModelConfigMocks {
  const modelConfig = getModelConfig(core);
  modelConfig.listPresets = vi.fn(async () => ({
    status: "ok",
    presets: input.presets ?? [],
  }));
  modelConfig.listAvailable = vi.fn(async () => {
    if (input.listAvailableError) {
      throw input.listAvailableError;
    }
    return { status: "ok", models: input.models ?? [] };
  });
  modelConfig.listAssignments = vi.fn(async () => {
    if (input.listAssignmentsError) {
      throw input.listAssignmentsError;
    }
    return { status: "ok", assignments: input.assignments ?? [] };
  });
  return modelConfig;
}

export function createModelPreset(overrides: Partial<ModelPresetFixture> = {}): ModelPresetFixture {
  return {
    preset_id: "00000000-0000-4000-8000-000000000001",
    preset_key: "preset-default",
    display_name: "Default",
    provider_key: "openai",
    model_id: "gpt-4.1",
    options: {},
    created_at: TEST_TIMESTAMP,
    updated_at: TEST_TIMESTAMP,
    ...overrides,
  };
}

export function createAvailableModel(
  overrides: Partial<AvailableModelFixture> = {},
): AvailableModelFixture {
  return {
    provider_key: "openai",
    provider_name: "OpenAI",
    model_id: "gpt-4.1",
    model_name: "GPT-4.1",
    family: null,
    reasoning: true,
    tool_call: true,
    modalities: { output: ["text"] },
    ...overrides,
  };
}

export function createModelAssignment(
  executionProfileId: ExecutionProfileId,
  preset: Pick<ModelPresetFixture, "preset_key" | "display_name" | "provider_key" | "model_id">,
): ModelAssignmentFixture {
  return {
    execution_profile_id: executionProfileId,
    preset_key: preset.preset_key,
    preset_display_name: preset.display_name,
    provider_key: preset.provider_key,
    model_id: preset.model_id,
  };
}

export function createAssignmentsForAllProfiles(
  preset: Pick<ModelPresetFixture, "preset_key" | "display_name" | "provider_key" | "model_id">,
): ModelAssignmentFixture[] {
  return ADMIN_HTTP_EXECUTION_PROFILE_IDS.map((executionProfileId) =>
    createModelAssignment(executionProfileId, preset),
  );
}

export function createUnassignedAssignmentsForAllProfiles(): ModelAssignmentFixture[] {
  return ADMIN_HTTP_EXECUTION_PROFILE_IDS.map((executionProfileId) => ({
    execution_profile_id: executionProfileId,
    preset_key: null,
    preset_display_name: null,
    provider_key: null,
    model_id: null,
  }));
}

export function stubModelsFetch(input: ModelsFetchStubInput): ReturnType<typeof vi.fn> {
  let deleteAttempt = 0;
  const fetchMock = vi.fn(async (requestInput: RequestInfo | URL, init?: RequestInit) => {
    const url = getRequestUrl(requestInput);
    const method = init?.method ?? "GET";
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-elevated-token");

    if (method === "GET" && url === "http://example.test/config/models/presets") {
      return jsonResponse({ status: "ok", presets: resolveValue(input.presets) });
    }
    if (method === "GET" && url === "http://example.test/config/models/presets/available") {
      return jsonResponse({ status: "ok", models: resolveValue(input.models) });
    }
    if (method === "GET" && url === "http://example.test/config/models/assignments") {
      return jsonResponse({ status: "ok", assignments: resolveValue(input.assignments) });
    }
    if (
      method === "POST" &&
      url === "http://example.test/config/models/presets" &&
      input.createPreset
    ) {
      expect(JSON.parse(String(init?.body ?? ""))).toEqual(input.createPreset.expectedBody);
      input.createPreset.afterCreate?.();
      return jsonResponse({ status: "ok", preset: input.createPreset.responsePreset }, 201);
    }
    if (
      method === "PATCH" &&
      url === `http://example.test/config/models/presets/${input.updatePreset?.presetKey}` &&
      input.updatePreset
    ) {
      expect(JSON.parse(String(init?.body ?? ""))).toEqual(input.updatePreset.expectedBody);
      input.updatePreset.afterUpdate?.();
      return jsonResponse(
        { status: "ok", preset: resolveValue(input.updatePreset.responsePreset) },
        200,
      );
    }
    if (
      method === "PUT" &&
      url === "http://example.test/config/models/assignments" &&
      input.updateAssignments
    ) {
      expect(JSON.parse(String(init?.body ?? ""))).toEqual(input.updateAssignments.expectedBody);
      input.updateAssignments.afterUpdate?.();
      return jsonResponse(
        { status: "ok", assignments: resolveValue(input.updateAssignments.responseAssignments) },
        200,
      );
    }
    if (
      method === "DELETE" &&
      url === `http://example.test/config/models/presets/${input.deletePreset?.presetKey}` &&
      input.deletePreset
    ) {
      deleteAttempt += 1;
      return input.deletePreset.handle(JSON.parse(String(init?.body ?? "")), deleteAttempt);
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
