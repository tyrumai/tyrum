import { AgentConfig } from "@tyrum/schemas";
import { expect, vi } from "vitest";
import { act, type Root } from "react";
import type { MobileHostApi } from "../src/index.js";
import { setControlledInputValue } from "./operator-ui.test-support.js";
import { sampleStatusResponse } from "./operator-ui.test-fixtures.js";

export function cleanup(root: Root | null, container: HTMLDivElement): void {
  act(() => {
    root?.unmount();
  });
  container.remove();
}

export function findButtonByText(
  container: HTMLElement | Document,
  label: string,
): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes(label),
    ) ?? null
  );
}

export function buildIssueStatusResponse(
  issues: Array<{
    code:
      | "agent_model_unconfigured"
      | "execution_profile_unassigned"
      | "no_model_presets"
      | "no_provider_accounts";
    severity: "error" | "warning";
    message: string;
    target: { kind: "agent" | "deployment" | "execution_profile"; id: string | null };
  }>,
) {
  return {
    ...sampleStatusResponse(),
    config_health: {
      status: "issues" as const,
      issues,
    },
  };
}

export function createActiveProviderGroup() {
  return {
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
    accounts: [
      {
        account_id: "00000000-0000-4000-8000-000000000111",
        account_key: "openai-primary",
        provider_key: "openai",
        display_name: "OpenAI",
        method_key: "api_key",
        type: "api_key",
        status: "active",
        config: {},
        configured_secret_keys: ["api_key"],
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
      },
    ],
  };
}

export function createConfiguredProviderGroup() {
  const { methods: _methods, ...configuredGroup } = createActiveProviderGroup();
  return configuredGroup;
}

export function createAgentConfigResponse(modelRef: string | null) {
  return {
    revision: 1,
    tenant_id: "tenant-1",
    agent_id: "11111111-1111-4111-8111-111111111111",
    agent_key: "default",
    config: AgentConfig.parse({
      model: { model: modelRef },
      persona: {
        name: "Default Agent",
        tone: "direct",
        palette: "graphite",
        character: "architect",
      },
    }),
    persona: {
      name: "Default Agent",
      tone: "direct",
      palette: "graphite",
      character: "architect",
    },
    config_sha256: "e".repeat(64),
    created_at: "2026-03-01T00:00:00.000Z",
    created_by: { kind: "tenant.token", token_id: "token-1" },
    reason: null,
    reverted_from_revision: null,
  };
}

function getControlByLabel<T extends HTMLElement>(
  container: HTMLElement | Document,
  label: string,
): T | null {
  const labels = Array.from(container.querySelectorAll<HTMLLabelElement>("label"));
  const match = labels.find((candidate) => candidate.textContent?.includes(label));
  const htmlFor = match?.htmlFor;
  if (!htmlFor) return null;
  const doc = container instanceof Document ? container : container.ownerDocument;
  return (doc?.getElementById(htmlFor) as T | null) ?? null;
}

export function setInputByLabel(container: HTMLElement, label: string, value: string): void {
  const input = getControlByLabel<HTMLInputElement>(container, label);
  expect(input).not.toBeNull();
  setControlledInputValue(input!, value);
}

export function createMobileHostApi(): MobileHostApi {
  const nextState = {
    platform: "ios" as const,
    enabled: true,
    status: "connected" as const,
    deviceId: "ios-node-1",
    error: null,
    actions: {
      "location.get_current": {
        enabled: true,
        availabilityStatus: "ready" as const,
        unavailableReason: null,
      },
      "camera.capture_photo": {
        enabled: true,
        availabilityStatus: "ready" as const,
        unavailableReason: null,
      },
      "audio.record_clip": {
        enabled: true,
        availabilityStatus: "ready" as const,
        unavailableReason: null,
      },
    },
  };

  return {
    node: {
      getState: vi.fn(async () => nextState),
      setEnabled: vi.fn(async () => nextState),
      setActionEnabled: vi.fn(async () => nextState),
    },
    onStateChange: vi.fn((_cb: (nextState: unknown) => void) => () => {}),
    onNavigationRequest: vi.fn((_cb: (request: unknown) => void) => () => {}),
  };
}

export function unassignedAssignments() {
  return [
    "interaction",
    "explorer_ro",
    "reviewer_ro",
    "planner",
    "jury",
    "executor_rw",
    "integrator",
  ].map((execution_profile_id) => ({
    execution_profile_id,
    preset_key: null,
    preset_display_name: null,
    provider_key: null,
    model_id: null,
  }));
}
