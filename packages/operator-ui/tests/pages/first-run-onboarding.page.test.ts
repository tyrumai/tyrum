// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorCore } from "@tyrum/operator-app";
import { FirstRunOnboardingPage } from "../../src/components/pages/first-run-onboarding.js";
import { cleanupTestRoot, renderIntoDocument, type TestRoot } from "../test-utils.js";

type CallbackStabilityState = {
  initialSelectModel: ((modelRef: string) => void) | null;
  initialSelectProvider: ((providerKey: string) => void) | null;
  initialRandomizeAgentName: (() => void) | null;
  selectModelChanged: boolean;
  selectProviderChanged: boolean;
  randomizeAgentNameChanged: boolean;
};

const testState = vi.hoisted(() => ({
  availableModels: [] as string[],
  adminSetMode: vi.fn(),
  clearOverride: vi.fn(),
  enterElevatedMode: vi.fn(async () => {}),
  existingAgentKeys: ["primary"],
  existingAgentNames: ["Atlas"],
  goToStep: vi.fn(),
  presets: [{ preset_key: "starter" }],
  refresh: vi.fn(async () => {}),
  setAgentName: vi.fn(),
  setAgentTone: vi.fn(),
  setModelFilter: vi.fn(),
  setModelState: vi.fn(),
  setProviderFilter: vi.fn(),
  setProviderState: vi.fn(),
  setSelectedPresetKey: vi.fn(),
  setThemeMode: vi.fn(),
  setThemePalette: vi.fn(),
  setWorkspacePolicyPreset: vi.fn(),
  supportedProviders: [] as string[],
  stability: {
    initialRandomizeAgentName: null,
    initialSelectModel: null,
    initialSelectProvider: null,
    randomizeAgentNameChanged: false,
    selectModelChanged: false,
    selectProviderChanged: false,
  } satisfies CallbackStabilityState,
}));

vi.mock("../../src/hooks/use-admin-access-mode.js", () => ({
  useAdminAccessModeOptional: () => ({
    hasStoredModePreference: false,
    mode: "on-demand",
    setMode: testState.adminSetMode,
  }),
}));

vi.mock("../../src/hooks/use-theme.js", () => ({
  useThemeOptional: () => ({
    hasStoredModePreference: true,
    hasStoredPalettePreference: true,
    mode: "dark",
    palette: "copper",
    setMode: testState.setThemeMode,
    setPalette: testState.setThemePalette,
  }),
}));

vi.mock("../../src/use-operator-store.js", () => ({
  useOperatorStore: () => ({
    status: {
      config_health: {
        issues: [],
      },
    },
  }),
}));

vi.mock("../../src/components/elevated-mode/elevated-mode-provider.js", () => ({
  useElevatedModeUiContext: () => ({
    enterElevatedMode: testState.enterElevatedMode,
  }),
}));

vi.mock("../../src/components/pages/admin-http-shared.js", () => ({
  useAdminMutationAccess: () => ({
    canMutate: true,
  }),
  useAdminMutationHttpClient: () => null,
}));

vi.mock("../../src/components/pages/admin-http-providers.shared.js", () => ({
  selectProviderFormState: ({ currentState }: { currentState: unknown }) => currentState,
}));

vi.mock("../../src/components/pages/admin-http-models.shared.js", () => ({
  selectModelDialogState: ({ currentState }: { currentState: unknown }) => currentState,
}));

vi.mock("../../src/components/pages/agent-setup-wizard.shared.js", () => ({
  buildAgentConfigFromPreset: vi.fn(),
  createUniqueAgentKey: vi.fn(),
  pickRandomAgentName: ({ currentName }: { currentName: string }) => currentName || "Atlas",
}));

vi.mock("../../src/components/pages/first-run-onboarding.logic.js", () => ({
  buildDefaultAssignments: vi.fn(),
  countActiveProviders: () => 0,
  createPresetFromState: vi.fn(),
  getOnboardingProviderFormError: () => null,
  getSelectedPresetLabel: () => "Starter",
  saveProviderAccountFromState: vi.fn(),
  useFirstRunOnboardingController: vi.fn(),
  useOnboardingCompletionEffect: () => {},
  useOnboardingData: () => ({
    data: {
      availableModels: testState.availableModels,
      errorMessage: null,
      existingAgentKeys: testState.existingAgentKeys,
      existingAgentNames: testState.existingAgentNames,
      loading: false,
      presets: testState.presets,
      primaryAgentConfig: null,
      primaryAgentKey: "primary",
      primaryAgentPersona: null,
      providers: [],
      registry: [],
    },
    refresh: testState.refresh,
  }),
  useOnboardingDrafts: () => ({
    agentName: "Atlas",
    agentTone: "",
    filteredAvailableModels: testState.availableModels,
    filteredProviders: testState.supportedProviders,
    modelFilter: "",
    modelState: { displayName: "", modelRef: "" },
    providerFilter: "",
    providerState: { methodKey: "", providerKey: "" },
    selectedMethod: null,
    selectedPresetKey: "starter",
    selectedProvider: null,
    setAgentName: testState.setAgentName,
    setAgentTone: testState.setAgentTone,
    setModelFilter: testState.setModelFilter,
    setModelState: testState.setModelState,
    setProviderFilter: testState.setProviderFilter,
    setProviderState: testState.setProviderState,
    setSelectedPresetKey: testState.setSelectedPresetKey,
    setWorkspacePolicyPreset: testState.setWorkspacePolicyPreset,
    supportedProviders: testState.supportedProviders,
    workspacePolicyPreset: "moderate",
  }),
  useOnboardingStepOverride: () => ({
    clearOverride: testState.clearOverride,
    goToStep: testState.goToStep,
    overrideStep: null,
    step: "agent",
  }),
}));

vi.mock("../../src/components/pages/first-run-onboarding.shared.js", () => ({
  buildOnboardingProgressItems: () => [],
  getRelevantOnboardingIssues: () => [],
  resolveVisibleFirstRunOnboardingStep: () => "agent",
}));

vi.mock("../../src/components/layout/app-page.js", async () => {
  const ReactModule = await import("react");
  return {
    AppPage: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("div", null, children),
  };
});

vi.mock("../../src/components/ui/alert.js", async () => {
  const ReactModule = await import("react");
  return {
    Alert: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement("div", null, children),
  };
});

vi.mock("../../src/components/ui/card.js", async () => {
  const ReactModule = await import("react");
  return {
    Card: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement("div", null, children),
    CardContent: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement("div", null, children),
  };
});

vi.mock("../../src/components/pages/first-run-onboarding.header.js", async () => {
  const ReactModule = await import("react");
  return {
    FirstRunOnboardingHeader: () => ReactModule.createElement("div", null),
  };
});

vi.mock("../../src/components/pages/first-run-onboarding.parts.js", async () => {
  const ReactModule = await import("react");
  return {
    OnboardingProgressCard: () => ReactModule.createElement("div", null),
  };
});

vi.mock("../../src/components/pages/workspace-policy-presets.js", () => ({
  saveWorkspacePolicyDeployment: vi.fn(),
}));

vi.mock("../../src/components/pages/first-run-onboarding.step-content.js", async () => {
  const ReactModule = await import("react");
  return {
    FirstRunOnboardingStepContent: (props: {
      onRandomizeAgentName: () => void;
      onSelectAdminAccessMode: (mode: "always-on" | "on-demand") => void;
      onSelectModel: (modelRef: string) => void;
      onSelectProvider: (providerKey: string) => void;
    }) => {
      if (testState.stability.initialRandomizeAgentName === null) {
        testState.stability.initialRandomizeAgentName = props.onRandomizeAgentName;
      } else if (testState.stability.initialRandomizeAgentName !== props.onRandomizeAgentName) {
        testState.stability.randomizeAgentNameChanged = true;
      }

      if (testState.stability.initialSelectModel === null) {
        testState.stability.initialSelectModel = props.onSelectModel;
      } else if (testState.stability.initialSelectModel !== props.onSelectModel) {
        testState.stability.selectModelChanged = true;
      }

      if (testState.stability.initialSelectProvider === null) {
        testState.stability.initialSelectProvider = props.onSelectProvider;
      } else if (testState.stability.initialSelectProvider !== props.onSelectProvider) {
        testState.stability.selectProviderChanged = true;
      }

      return ReactModule.createElement(
        "div",
        null,
        ReactModule.createElement("div", {
          "data-testid": "randomize-handler-changed",
          "data-value": String(testState.stability.randomizeAgentNameChanged),
        }),
        ReactModule.createElement("div", {
          "data-testid": "select-model-handler-changed",
          "data-value": String(testState.stability.selectModelChanged),
        }),
        ReactModule.createElement("div", {
          "data-testid": "select-provider-handler-changed",
          "data-value": String(testState.stability.selectProviderChanged),
        }),
        ReactModule.createElement(
          "button",
          {
            "data-testid": "trigger-rerender",
            onClick: () => {
              props.onSelectAdminAccessMode("always-on");
            },
          },
          "Trigger rerender",
        ),
      );
    },
  };
});

describe("FirstRunOnboardingPage", () => {
  let testRoot: TestRoot | null = null;

  beforeEach(() => {
    testState.adminSetMode.mockReset();
    testState.clearOverride.mockReset();
    testState.enterElevatedMode.mockReset();
    testState.goToStep.mockReset();
    testState.refresh.mockReset();
    testState.setAgentName.mockReset();
    testState.setAgentTone.mockReset();
    testState.setModelFilter.mockReset();
    testState.setModelState.mockReset();
    testState.setProviderFilter.mockReset();
    testState.setProviderState.mockReset();
    testState.setSelectedPresetKey.mockReset();
    testState.setThemeMode.mockReset();
    testState.setThemePalette.mockReset();
    testState.setWorkspacePolicyPreset.mockReset();
    testState.stability.initialRandomizeAgentName = null;
    testState.stability.initialSelectModel = null;
    testState.stability.initialSelectProvider = null;
    testState.stability.randomizeAgentNameChanged = false;
    testState.stability.selectModelChanged = false;
    testState.stability.selectProviderChanged = false;
  });

  afterEach(() => {
    if (testRoot) {
      cleanupTestRoot(testRoot);
      testRoot = null;
    }
    vi.clearAllMocks();
  });

  it("keeps onboarding callbacks stable across local page rerenders", async () => {
    const core = {
      statusStore: {},
      syncAllNow: async () => {},
    } as OperatorCore;

    testRoot = renderIntoDocument(
      React.createElement(FirstRunOnboardingPage, {
        core,
        onClose: vi.fn(),
        onMarkCompleted: vi.fn(),
        onNavigate: vi.fn(),
        onSkip: vi.fn(),
      }),
    );

    expect(
      testRoot.container
        .querySelector('[data-testid="randomize-handler-changed"]')
        ?.getAttribute("data-value"),
    ).toBe("false");
    expect(
      testRoot.container
        .querySelector('[data-testid="select-model-handler-changed"]')
        ?.getAttribute("data-value"),
    ).toBe("false");
    expect(
      testRoot.container
        .querySelector('[data-testid="select-provider-handler-changed"]')
        ?.getAttribute("data-value"),
    ).toBe("false");

    const rerenderButton = testRoot.container.querySelector<HTMLButtonElement>(
      '[data-testid="trigger-rerender"]',
    );
    expect(rerenderButton).not.toBeNull();

    await act(async () => {
      rerenderButton?.click();
      await Promise.resolve();
    });

    expect(
      testRoot.container
        .querySelector('[data-testid="randomize-handler-changed"]')
        ?.getAttribute("data-value"),
    ).toBe("false");
    expect(
      testRoot.container
        .querySelector('[data-testid="select-model-handler-changed"]')
        ?.getAttribute("data-value"),
    ).toBe("false");
    expect(
      testRoot.container
        .querySelector('[data-testid="select-provider-handler-changed"]')
        ?.getAttribute("data-value"),
    ).toBe("false");
  });
});
