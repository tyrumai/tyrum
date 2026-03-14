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
  const presets = [
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
  ];
  let assignments = EXECUTION_PROFILE_IDS.map(createModelAssignment);

  const modelAssignmentsUpdate = vi.fn(
    async (input: { assignments: Record<string, string | null> }) => {
      assignments = EXECUTION_PROFILE_IDS.map((execution_profile_id) => {
        const preset_key = input.assignments[execution_profile_id] ?? null;
        const preset = presets.find((candidate) => candidate.preset_key === preset_key) ?? null;
        return {
          execution_profile_id,
          preset_key,
          preset_display_name: preset?.display_name ?? null,
          provider_key: preset?.provider_key ?? null,
          model_id: preset?.model_id ?? null,
        };
      });

      return {
        status: "ok" as const,
        assignments,
      };
    },
  );

  return {
    modelConfig: {
      listPresets: vi.fn(async () => ({
        status: "ok" as const,
        presets,
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
      createPreset: vi.fn(
        async (input: {
          display_name: string;
          provider_key: string;
          model_id: string;
          options: Record<string, string>;
        }) => {
          const preset = {
            preset_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            preset_key: `preset-${
              input.display_name
                .toLowerCase()
                .replaceAll(/[^a-z0-9]+/g, "-")
                .replaceAll(/^-+|-+$/g, "") || "new"
            }`,
            display_name: input.display_name,
            provider_key: input.provider_key,
            model_id: input.model_id,
            options: input.options,
            created_at: "2026-03-02T00:00:00.000Z",
            updated_at: "2026-03-02T00:00:00.000Z",
          };
          presets.push(preset);
          return { status: "ok" as const, preset };
        },
      ),
      updatePreset: vi.fn(
        async (
          presetKey: string,
          input: { display_name?: string; options?: Record<string, string> },
        ) => {
          const preset =
            presets.find((candidate) => candidate.preset_key === presetKey) ?? presets[0];
          if (!preset) {
            throw new Error(`Unknown preset: ${presetKey}`);
          }
          if (input.display_name) {
            preset.display_name = input.display_name;
          }
          if (input.options) {
            preset.options = input.options;
          }
          preset.updated_at = "2026-03-03T00:00:00.000Z";
          return { status: "ok" as const, preset };
        },
      ),
      deletePreset: vi.fn(async () => ({ status: "ok" as const })),
      listAssignments: vi.fn(async () => ({
        status: "ok" as const,
        assignments,
      })),
      updateAssignments: modelAssignmentsUpdate,
    },
    modelAssignmentsUpdate,
  };
}
