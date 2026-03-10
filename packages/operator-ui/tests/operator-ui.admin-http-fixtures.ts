import { vi } from "vitest";
import { EXECUTION_PROFILE_IDS } from "./operator-ui.test-support.js";

function createModelAssignment(execution_profile_id: string) {
  return {
    execution_profile_id,
    preset_key: "preset-default",
    preset_display_name: "Default",
    provider_key: "openai",
    model_id: "gpt-4.1",
  };
}

export function createProviderConfigHttpFixtures() {
  return {
    listRegistry: vi.fn(async () => ({
      status: "ok" as const,
      providers: [
        {
          provider_key: "openai",
          name: "OpenAI",
          doc: null,
          supported: true,
          methods: [
            {
              method_key: "api_key",
              label: "API key",
              type: "api_key",
              fields: [
                {
                  key: "api_key",
                  label: "API key",
                  description: null,
                  kind: "secret",
                  input: "password",
                  required: true,
                },
              ],
            },
          ],
        },
      ],
    })),
    listProviders: vi.fn(async () => ({
      status: "ok" as const,
      providers: [],
    })),
    createAccount: vi.fn(async () => ({ status: "ok" as const })),
    updateAccount: vi.fn(async () => ({ status: "ok" as const })),
    deleteAccount: vi.fn(async () => ({ status: "ok" as const })),
    deleteProvider: vi.fn(async () => ({ status: "ok" as const })),
  };
}

export function createModelConfigHttpFixtures() {
  const modelAssignmentsUpdate = vi.fn(async () => ({
    status: "ok" as const,
    assignments: EXECUTION_PROFILE_IDS.map(createModelAssignment),
  }));

  return {
    modelConfig: {
      listPresets: vi.fn(async () => ({
        status: "ok" as const,
        presets: [
          {
            preset_id: "c2d1f6c6-f541-46a8-9f47-8a2d0ff3c9e5",
            preset_key: "preset-default",
            display_name: "Default",
            provider_key: "openai",
            model_id: "gpt-4.1",
            options: {},
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
          },
          {
            preset_id: "d5c709e9-4585-426e-81ed-7904f7fbbe1b",
            preset_key: "preset-review",
            display_name: "Review",
            provider_key: "openai",
            model_id: "gpt-4.1-mini",
            options: { reasoning_effort: "medium" },
            created_at: "2026-03-01T00:00:00.000Z",
            updated_at: "2026-03-01T00:00:00.000Z",
          },
        ],
      })),
      listAvailable: vi.fn(async () => ({
        status: "ok" as const,
        models: [
          {
            provider_key: "openai",
            provider_name: "OpenAI",
            model_id: "gpt-4.1",
            model_name: "GPT-4.1",
            family: null,
            reasoning: true,
            tool_call: true,
            modalities: { output: ["text"] },
          },
          {
            provider_key: "openai",
            provider_name: "OpenAI",
            model_id: "gpt-4.1-mini",
            model_name: "GPT-4.1 Mini",
            family: null,
            reasoning: true,
            tool_call: true,
            modalities: { output: ["text"] },
          },
        ],
      })),
      createPreset: vi.fn(async () => ({ status: "ok" as const })),
      updatePreset: vi.fn(async () => ({ status: "ok" as const })),
      deletePreset: vi.fn(async () => ({ status: "ok" as const })),
      listAssignments: vi.fn(async () => ({
        status: "ok" as const,
        assignments: EXECUTION_PROFILE_IDS.map(createModelAssignment),
      })),
      updateAssignments: modelAssignmentsUpdate,
    },
    modelAssignmentsUpdate,
  };
}
