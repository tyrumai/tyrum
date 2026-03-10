import type { OperatorCore } from "../../../operator-core/src/index.js";
import { expect } from "vitest";
import {
  ADMIN_HTTP_EXECUTION_PROFILE_IDS,
  createAssignmentsForAllProfiles,
  createAvailableModel,
  createModelAssignment,
  createModelPreset,
  createUnassignedAssignmentsForAllProfiles,
  setModelConfigResponses,
  stubModelsFetch,
} from "./admin-page.http.test-support.js";

export function setupFirstAssignmentSaveScenario(core: OperatorCore) {
  const presetDefault = createModelPreset({
    preset_id: "c2d1f6c6-f541-46a8-9f47-8a2d0ff3c9e5",
  });
  const presetReview = createModelPreset({
    preset_id: "d5c709e9-4585-426e-81ed-7904f7fbbe1b",
    preset_key: "preset-review",
    display_name: "Review",
    model_id: "gpt-4.1-mini",
  });

  setModelConfigResponses(core, {
    presets: [presetDefault, presetReview],
    models: [createAvailableModel()],
    assignments: createUnassignedAssignmentsForAllProfiles(),
  });

  return { presetReview };
}

export function setupAssignmentsUpdateScenario(core: OperatorCore) {
  const presetDefault = createModelPreset({
    preset_id: "00000000-0000-4000-8000-000000000011",
  });
  const presetReview = createModelPreset({
    preset_id: "00000000-0000-4000-8000-000000000012",
    preset_key: "preset-review",
    display_name: "Review",
    model_id: "gpt-4.1-mini",
  });
  const availableModels = [
    createAvailableModel(),
    createAvailableModel({ model_id: "gpt-4.1-mini", model_name: "GPT-4.1 Mini" }),
  ];

  let assignments = createAssignmentsForAllProfiles(presetDefault);
  setModelConfigResponses(core, {
    presets: [presetDefault, presetReview],
    models: availableModels,
    assignments,
  });

  const fetchMock = stubModelsFetch({
    presets: [presetDefault, presetReview],
    models: availableModels,
    assignments: () => assignments,
    updateAssignments: {
      expectedBody: {
        assignments: Object.fromEntries(
          ADMIN_HTTP_EXECUTION_PROFILE_IDS.map((profileId) => [
            profileId,
            profileId === "interaction" ? presetReview.preset_key : presetDefault.preset_key,
          ]),
        ),
      },
      afterUpdate: () => {
        assignments = ADMIN_HTTP_EXECUTION_PROFILE_IDS.map((profileId) =>
          createModelAssignment(
            profileId,
            profileId === "interaction" ? presetReview : presetDefault,
          ),
        );
      },
      responseAssignments: () => assignments,
    },
  });

  return { fetchMock, presetReview };
}

export function setupCreatePresetScenario(core: OperatorCore) {
  let presets: Array<ReturnType<typeof createModelPreset>> = [];
  const createdPreset = createModelPreset({
    preset_id: "00000000-0000-4000-8000-000000000021",
    preset_key: "preset-gpt-4-1-mini",
    display_name: "GPT-4.1 Mini",
    model_id: "gpt-4.1-mini",
    options: { reasoning_effort: "high" },
  });
  const availableModels = [
    createAvailableModel(),
    createAvailableModel({ model_id: "gpt-4.1-mini", model_name: "GPT-4.1 Mini" }),
  ];

  setModelConfigResponses(core, {
    presets,
    models: availableModels,
    assignments: createUnassignedAssignmentsForAllProfiles(),
  });

  const fetchMock = stubModelsFetch({
    presets: () => presets,
    models: availableModels,
    assignments: createUnassignedAssignmentsForAllProfiles(),
    createPreset: {
      expectedBody: {
        display_name: "GPT-4.1 Mini",
        provider_key: "openai",
        model_id: "gpt-4.1-mini",
        options: { reasoning_effort: "high" },
      },
      responsePreset: createdPreset,
      afterCreate: () => {
        presets = [createdPreset];
      },
    },
  });

  return { fetchMock };
}

export function setupRefreshPresetScenario(core: OperatorCore) {
  const availableModels = [
    createAvailableModel({ model_id: "gpt-4.1-mini", model_name: "GPT-4.1 Mini" }),
  ];
  const createdPreset = createModelPreset({
    preset_id: "00000000-0000-4000-8000-000000000022",
    preset_key: "preset-gpt-4-1-mini",
    display_name: "GPT-4.1 Mini",
    model_id: "gpt-4.1-mini",
  });

  const modelConfig = setModelConfigResponses(core, {
    presets: [],
    models: availableModels,
    assignments: createUnassignedAssignmentsForAllProfiles(),
  });

  const fetchMock = stubModelsFetch({
    presets: [createdPreset],
    models: availableModels,
    assignments: createUnassignedAssignmentsForAllProfiles(),
    createPreset: {
      expectedBody: {
        display_name: "GPT-4.1 Mini",
        provider_key: "openai",
        model_id: "gpt-4.1-mini",
        options: {},
      },
      responsePreset: createdPreset,
    },
  });

  return { fetchMock, modelConfig };
}

export function setupUpdatePresetScenario(core: OperatorCore) {
  let presets = [
    createModelPreset({
      preset_id: "00000000-0000-4000-8000-000000000031",
      preset_key: "legacy-openai",
      display_name: "Legacy OpenAI",
    }),
  ];
  const availableModels = [
    createAvailableModel({
      provider_key: "anthropic",
      provider_name: "Anthropic",
      model_id: "claude-3.7-sonnet",
      model_name: "Claude 3.7 Sonnet",
    }),
  ];

  setModelConfigResponses(core, {
    presets,
    models: availableModels,
    assignments: createUnassignedAssignmentsForAllProfiles(),
  });

  const fetchMock = stubModelsFetch({
    presets: () => presets,
    models: availableModels,
    assignments: createUnassignedAssignmentsForAllProfiles(),
    updatePreset: {
      presetKey: "legacy-openai",
      expectedBody: {
        display_name: "Renamed preset",
        options: { reasoning_effort: "medium" },
      },
      afterUpdate: () => {
        presets = [
          createModelPreset({
            ...presets[0],
            display_name: "Renamed preset",
            options: { reasoning_effort: "medium" },
          }),
        ];
      },
      responsePreset: () => presets[0]!,
    },
  });

  return { fetchMock };
}

export function setupDeletePresetScenario(core: OperatorCore) {
  let presets = [
    createModelPreset({
      preset_id: "00000000-0000-4000-8000-000000000041",
    }),
    createModelPreset({
      preset_id: "00000000-0000-4000-8000-000000000042",
      preset_key: "preset-review",
      display_name: "Review",
      model_id: "gpt-4.1-mini",
    }),
  ];
  let assignments = createUnassignedAssignmentsForAllProfiles().map((assignment) =>
    assignment.execution_profile_id === "interaction"
      ? createModelAssignment("interaction", presets[0]!)
      : assignment,
  );
  const availableModels = [
    createAvailableModel(),
    createAvailableModel({ model_id: "gpt-4.1-mini", model_name: "GPT-4.1 Mini" }),
  ];

  setModelConfigResponses(core, { presets, models: availableModels, assignments });

  const fetchMock = stubModelsFetch({
    presets: () => presets,
    models: availableModels,
    assignments: () => assignments,
    deletePreset: {
      presetKey: "preset-default",
      handle: (body, attempt) => {
        if (attempt === 1) {
          expect(body).toEqual({ replacement_assignments: { interaction: "preset-review" } });
          return new Response(
            JSON.stringify({
              error: "assignment_required",
              message: "Planner still requires a replacement.",
              required_execution_profile_ids: ["planner"],
            }),
            { status: 409 },
          );
        }

        expect(body).toEqual({
          replacement_assignments: {
            interaction: "preset-review",
            planner: "preset-review",
          },
        });
        presets = [presets[1]!];
        assignments = createUnassignedAssignmentsForAllProfiles().map((assignment) => {
          if (assignment.execution_profile_id === "interaction") {
            return createModelAssignment("interaction", presets[0]!);
          }
          if (assignment.execution_profile_id === "planner") {
            return createModelAssignment("planner", presets[0]!);
          }
          return assignment;
        });
        return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
      },
    },
  });

  return { fetchMock };
}
