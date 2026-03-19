import type { OperatorCore } from "@tyrum/operator-core";
import type {
  AgentCapabilitiesResponse,
  ManagedAgentDetail,
  ManagedExtensionDetail,
} from "@tyrum/contracts";
import * as React from "react";
import { toast } from "sonner";
import { useApiAction } from "../../hooks/use-api-action.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { modelRefFor, type ModelPreset } from "./admin-http-models.shared.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import { LoadingState } from "../ui/loading-state.js";
import {
  type AgentEditorFormState,
  type PreservedMcpConfig,
  applyMemorySettingsToForm,
  buildPayload,
  createBlankForm,
  snapshotToForm,
} from "./agents-page-editor-form.js";
import { AgentEditorSections } from "./agents-page-editor-sections.js";

type AgentEditorProps = {
  core: OperatorCore;
  mode: "create" | "edit";
  createNonce: number;
  agentKey?: string;
  onSaved: (agentKey: string) => void;
  onCancelCreate: () => void;
};

const CREATE_CAPABILITIES_DEBOUNCE_MS = 250;

type AgentMcpSettingsDraft = {
  mode: "inherit" | "override";
  format: "json" | "yaml";
  text: string;
};

function createEmptyPreservedMcpConfig(): PreservedMcpConfig {
  return {
    pre_turn_tools: [],
    server_settings: {},
  };
}

function parseJsonSettingsText(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("MCP override settings must be a JSON object.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("MCP override settings must be a JSON object.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("MCP override settings must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]),
    );
  }
  return value;
}

function stableRecordStringify(value: Record<string, unknown>): string {
  return JSON.stringify(sortJsonValue(value));
}

function resolveSelectedPrimaryPreset(input: {
  presets: ModelPreset[];
  modelRef: string;
  options: Record<string, unknown>;
}): ModelPreset | null {
  const trimmedModel = input.modelRef.trim();
  if (!trimmedModel) return null;
  const normalizedOptions = stableRecordStringify(input.options);
  const matches = input.presets.filter((preset) => {
    return (
      modelRefFor(preset) === trimmedModel &&
      stableRecordStringify(preset.options) === normalizedOptions
    );
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function AgentsPageEditor({
  core,
  mode,
  createNonce,
  agentKey,
  onSaved,
  onCancelCreate,
}: AgentEditorProps): React.ReactElement {
  const [form, setForm] = React.useState<AgentEditorFormState>(createBlankForm());
  const [loading, setLoading] = React.useState(mode === "edit");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [capabilities, setCapabilities] = React.useState<AgentCapabilitiesResponse | null>(null);
  const [capabilitiesLoading, setCapabilitiesLoading] = React.useState(true);
  const [capabilitiesError, setCapabilitiesError] = React.useState<string | null>(null);
  const [modelPresets, setModelPresets] = React.useState<ModelPreset[]>([]);
  const [modelPresetsLoading, setModelPresetsLoading] = React.useState(true);
  const [modelPresetsError, setModelPresetsError] = React.useState<string | null>(null);
  const [preservedModelOptions, setPreservedModelOptions] = React.useState<Record<string, unknown>>(
    {},
  );
  const [preservedMcpConfig, setPreservedMcpConfig] = React.useState<PreservedMcpConfig>(
    createEmptyPreservedMcpConfig(),
  );
  const [mcpExtensionsById, setMcpExtensionsById] = React.useState<
    Record<string, ManagedExtensionDetail>
  >({});
  const [mcpExtensionsLoading, setMcpExtensionsLoading] = React.useState(true);
  const [mcpExtensionsError, setMcpExtensionsError] = React.useState<string | null>(null);
  const [mcpSettingsDrafts, setMcpSettingsDrafts] = React.useState<
    Record<string, AgentMcpSettingsDraft>
  >({});
  const saveAction = useApiAction<ManagedAgentDetail>();
  const deferredCreateCapabilitiesAgentKey = React.useDeferredValue(
    form.agentKey.trim() || "default",
  );
  const [debouncedCreateCapabilitiesAgentKey, setDebouncedCreateCapabilitiesAgentKey] =
    React.useState("default");
  const capabilitiesAgentKey =
    mode === "create" ? debouncedCreateCapabilitiesAgentKey : agentKey?.trim() || "default";

  React.useEffect(() => {
    if (mode !== "create") return;
    if (deferredCreateCapabilitiesAgentKey === "default") {
      setDebouncedCreateCapabilitiesAgentKey("default");
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      setDebouncedCreateCapabilitiesAgentKey(deferredCreateCapabilitiesAgentKey);
    }, CREATE_CAPABILITIES_DEBOUNCE_MS);
    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [createNonce, deferredCreateCapabilitiesAgentKey, mode]);

  React.useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setModelPresetsLoading(true);
      setModelPresetsError(null);

      if (mode === "create") {
        setForm(createBlankForm());
        setPreservedModelOptions({});
        setPreservedMcpConfig(createEmptyPreservedMcpConfig());
        setMcpSettingsDrafts({});
        setLoadError(null);
        setLoading(false);
        try {
          const presetList = await core.http.modelConfig.listPresets();
          if (cancelled) return;
          setModelPresets(presetList.presets);
        } catch (error) {
          if (cancelled) return;
          setModelPresets([]);
          setModelPresetsError(formatErrorMessage(error));
        } finally {
          if (!cancelled) {
            setModelPresetsLoading(false);
          }
        }
        return;
      }
      if (!agentKey) {
        setLoadError("Select an agent to edit.");
        setLoading(false);
        setModelPresets([]);
        setModelPresetsLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);
      try {
        const [detailResult, presetResult] = await Promise.allSettled([
          core.http.agents.get(agentKey),
          core.http.modelConfig.listPresets(),
        ]);
        if (cancelled) return;

        if (detailResult.status === "fulfilled") {
          setForm(
            snapshotToForm({
              agentKey: detailResult.value.agent_key,
              config: detailResult.value.config,
              identity: detailResult.value.identity,
            }),
          );
          setPreservedModelOptions(detailResult.value.config.model.options ?? {});
          setPreservedMcpConfig({
            pre_turn_tools: detailResult.value.config.mcp.pre_turn_tools,
            server_settings: detailResult.value.config.mcp.server_settings,
          });
          setMcpSettingsDrafts({});
        } else {
          setLoadError(formatErrorMessage(detailResult.reason));
        }

        if (presetResult.status === "fulfilled") {
          setModelPresets(presetResult.value.presets);
          setModelPresetsError(null);
        } else {
          setModelPresets([]);
          setModelPresetsError(formatErrorMessage(presetResult.reason));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setModelPresetsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [agentKey, core.http.agents, core.http.modelConfig, createNonce, mode]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadMcpExtensions(): Promise<void> {
      setMcpExtensionsLoading(true);
      setMcpExtensionsError(null);
      try {
        const listed = await core.http.extensions.list("mcp");
        const detailResults = await Promise.all(
          listed.items.map(async (item) => await core.http.extensions.get("mcp", item.key)),
        );
        if (cancelled) return;
        setMcpExtensionsById(
          Object.fromEntries(detailResults.map((result) => [result.item.key, result.item])),
        );
      } catch (error) {
        if (cancelled) return;
        setMcpExtensionsById({});
        setMcpExtensionsError(formatErrorMessage(error));
      } finally {
        if (!cancelled) {
          setMcpExtensionsLoading(false);
        }
      }
    }

    void loadMcpExtensions();
    return () => {
      cancelled = true;
    };
  }, [core.http.extensions]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadCapabilities(): Promise<void> {
      setCapabilitiesLoading(true);
      setCapabilitiesError(null);
      try {
        const result = await core.http.agents.capabilities(capabilitiesAgentKey);
        if (cancelled) return;
        setCapabilities(result);
      } catch (error) {
        if (cancelled) return;
        setCapabilities(null);
        setCapabilitiesError(formatErrorMessage(error));
      } finally {
        if (!cancelled) {
          setCapabilitiesLoading(false);
        }
      }
    }

    void loadCapabilities();
    return () => {
      cancelled = true;
    };
  }, [capabilitiesAgentKey, core.http.agents]);

  const selectedPrimaryPreset = React.useMemo(
    () =>
      resolveSelectedPrimaryPreset({
        presets: modelPresets,
        modelRef: form.model,
        options: preservedModelOptions,
      }),
    [form.model, modelPresets, preservedModelOptions],
  );

  const unsupportedModelOptions =
    !selectedPrimaryPreset && Object.keys(preservedModelOptions).length > 0
      ? JSON.stringify(preservedModelOptions, null, 2)
      : null;
  const legacyPrimarySelection = React.useMemo(() => {
    const trimmedModel = form.model.trim();
    if (!trimmedModel || selectedPrimaryPreset) return null;
    return {
      modelRef: trimmedModel,
      optionsJson: unsupportedModelOptions,
    };
  }, [form.model, selectedPrimaryPreset, unsupportedModelOptions]);

  const setField = React.useCallback(
    <K extends keyof AgentEditorFormState>(key: K, value: AgentEditorFormState[K]) => {
      setForm((current) => ({ ...current, [key]: value }));
    },
    [],
  );
  const selectPrimaryPreset = React.useCallback(
    (preset: ModelPreset) => {
      setField("model", modelRefFor(preset));
      setPreservedModelOptions(preset.options);
    },
    [setField],
  );
  const clearPrimaryModel = React.useCallback(() => {
    setField("model", "");
    setPreservedModelOptions({});
  }, [setField]);

  const memoryExtension = mcpExtensionsById["memory"];

  const handleMemorySettingsModeChange = React.useCallback(
    (modeValue: AgentEditorFormState["memorySettingsMode"]) => {
      if (modeValue === "inherit") {
        setField("memorySettingsMode", "inherit");
        return;
      }

      const explicitMemorySettings = preservedMcpConfig.server_settings["memory"];
      setForm((current) => {
        const seeded = explicitMemorySettings ?? memoryExtension?.default_mcp_server_settings_json;
        if (!seeded) {
          return { ...current, memorySettingsMode: "override" };
        }
        return applyMemorySettingsToForm(current, seeded, "override");
      });
    },
    [
      memoryExtension?.default_mcp_server_settings_json,
      preservedMcpConfig.server_settings,
      setField,
    ],
  );

  const updateMcpSettingsDraft = React.useCallback(
    (serverId: string, draft: AgentMcpSettingsDraft) => {
      setMcpSettingsDrafts((current) => ({ ...current, [serverId]: draft }));
    },
    [],
  );

  async function buildResolvedMcpConfig(): Promise<PreservedMcpConfig> {
    const nextServerSettings: Record<string, Record<string, unknown>> = {
      ...preservedMcpConfig.server_settings,
    };
    for (const [serverId, draft] of Object.entries(mcpSettingsDrafts)) {
      if (draft.mode === "inherit") {
        delete nextServerSettings[serverId];
        continue;
      }
      nextServerSettings[serverId] =
        draft.format === "json"
          ? parseJsonSettingsText(draft.text)
          : (
              await core.http.extensions.parseMcpSettings({
                settings_format: draft.format,
                settings_text: draft.text,
              })
            ).settings;
    }

    return {
      pre_turn_tools: preservedMcpConfig.pre_turn_tools,
      server_settings: nextServerSettings,
    };
  }

  const save = async (): Promise<void> => {
    try {
      if (mode === "create") {
        const created = await saveAction.runAndThrow(async () => {
          const resolvedMcpConfig = await buildResolvedMcpConfig();
          const payload = buildPayload(form, preservedModelOptions, resolvedMcpConfig);
          return await core.http.agents.create(payload);
        });
        onSaved(created.agent_key);
        return;
      }

      const updated = await saveAction.runAndThrow(async () => {
        const resolvedMcpConfig = await buildResolvedMcpConfig();
        const payload = buildPayload(form, preservedModelOptions, resolvedMcpConfig);
        const targetKey = agentKey ?? payload.agent_key;
        return await core.http.agents.update(targetKey, {
          config: payload.config,
        });
      });
      onSaved(updated.agent_key);
    } catch (error) {
      toast.error("Save failed", { description: formatErrorMessage(error) });
      return;
    }
  };

  if (loadError) {
    return (
      <Alert
        variant="error"
        title="Agent editor unavailable"
        description={loadError}
        onDismiss={() => setLoadError(null)}
      />
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent>
          <LoadingState variant="centered" label="Loading agent editor…" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4" data-testid="agents-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-fg-muted">
          {mode === "create"
            ? "Create a managed agent and persist its configuration."
            : "Edit the selected agent's persisted configuration."}
        </div>
        <div className="flex flex-wrap gap-2">
          {mode === "create" ? (
            <Button type="button" variant="secondary" onClick={onCancelCreate}>
              Cancel
            </Button>
          ) : null}
          <Button
            type="button"
            data-testid="agents-editor-save"
            isLoading={saveAction.isLoading}
            onClick={() => {
              void save();
            }}
          >
            {mode === "create" ? "Create agent" : "Save changes"}
          </Button>
        </div>
      </div>

      {unsupportedModelOptions ? (
        <Alert
          variant="info"
          title="Advanced model options preserved"
          description="This editor keeps existing provider-specific model options intact, but it does not edit them yet."
        />
      ) : null}
      {mcpExtensionsError ? (
        <Alert
          variant="warning"
          title="Shared MCP defaults unavailable"
          description={mcpExtensionsError}
        />
      ) : null}

      <AgentEditorSections
        form={form}
        mode={mode}
        setField={setField}
        modelPresets={modelPresets}
        modelPresetsLoading={modelPresetsLoading}
        modelPresetsError={modelPresetsError}
        selectedPrimaryPreset={selectedPrimaryPreset}
        legacyPrimarySelection={legacyPrimarySelection}
        onSelectPrimaryPreset={selectPrimaryPreset}
        onClearPrimaryModel={clearPrimaryModel}
        unsupportedModelOptions={unsupportedModelOptions}
        capabilities={capabilities}
        capabilitiesLoading={capabilitiesLoading}
        capabilitiesError={capabilitiesError}
        mcpExtensionDetailsById={mcpExtensionsById}
        mcpExplicitServerSettings={preservedMcpConfig.server_settings}
        mcpExtensionsLoading={mcpExtensionsLoading}
        mcpExtensionsError={mcpExtensionsError}
        onMemorySettingsModeChange={handleMemorySettingsModeChange}
        mcpSettingsDrafts={mcpSettingsDrafts}
        onMcpSettingsDraftChange={updateMcpSettingsDraft}
      />
    </div>
  );
}
