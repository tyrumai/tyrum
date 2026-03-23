import type { AgentCapabilitiesResponse, ManagedExtensionDetail } from "@tyrum/contracts";
import { PERSONA_TONES } from "@tyrum/contracts";
import { ChevronRight } from "lucide-react";
import type { AgentEditorFormState, AgentEditorSetField } from "./agents-page-editor-form.js";
import { AccessTransferField } from "./agents-page-editor-access-transfer.js";
import type { ModelPreset } from "./admin-http-models.shared.js";
import {
  AgentEditorMcpOverrides,
  type AgentMcpSettingsDraft,
  effectiveSourceLabel,
} from "./agents-page-editor-mcp-overrides.js";
import { AgentEditorModelFields } from "./agents-page-editor-models.js";
import { FieldGroup, ToggleField } from "./agents-page-editor-shared.js";
import { MemorySettingsFields } from "./memory-settings-fields.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { StructuredValue } from "../ui/structured-value.js";

export function AgentEditorSections({
  form,
  mode,
  setField,
  capabilities,
  capabilitiesLoading,
  capabilitiesError,
  modelPresets,
  modelPresetsLoading,
  modelPresetsError,
  selectedPrimaryPreset,
  legacyPrimarySelection,
  onSelectPrimaryPreset,
  onClearPrimaryModel,
  unsupportedModelOptions,
  preservedModelOptionsRaw,
  mcpExtensionDetailsById,
  mcpExplicitServerSettings,
  mcpExtensionsLoading,
  mcpExtensionsError,
  onMemorySettingsModeChange,
  mcpSettingsDrafts,
  onMcpSettingsDraftChange,
}: {
  form: AgentEditorFormState;
  mode: "create" | "edit";
  setField: AgentEditorSetField;
  capabilities: AgentCapabilitiesResponse | null;
  capabilitiesLoading: boolean;
  capabilitiesError: string | null;
  modelPresets: ModelPreset[];
  modelPresetsLoading: boolean;
  modelPresetsError: string | null;
  selectedPrimaryPreset: ModelPreset | null;
  legacyPrimarySelection: { modelRef: string; optionsJson: string | null } | null;
  onSelectPrimaryPreset: (preset: ModelPreset) => void;
  onClearPrimaryModel: () => void;
  unsupportedModelOptions: string | null;
  preservedModelOptionsRaw: Record<string, unknown>;
  mcpExtensionDetailsById: Record<string, ManagedExtensionDetail>;
  mcpExplicitServerSettings: Record<string, Record<string, unknown>>;
  mcpExtensionsLoading: boolean;
  mcpExtensionsError: string | null;
  onMemorySettingsModeChange: (modeValue: AgentEditorFormState["memorySettingsMode"]) => void;
  mcpSettingsDrafts: Record<string, AgentMcpSettingsDraft>;
  onMcpSettingsDraftChange: (serverId: string, draft: AgentMcpSettingsDraft) => void;
}) {
  const memoryDetail = mcpExtensionDetailsById["memory"];
  const memorySharedDefaultAvailable = Boolean(memoryDetail?.default_mcp_server_settings_json);
  const mcpSettingsItems = (capabilities?.mcp.items ?? []).filter(
    (item: { id: string }) => item.id !== "memory",
  );

  return (
    <>
      <FieldGroup title="Profile" description="Operator-facing persona settings for this agent.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            data-testid="agents-editor-agent-key"
            label="Agent key"
            value={form.agentKey}
            disabled={mode !== "create"}
            helperText="Stable key used in URLs and runtime routing."
            onChange={(event) => {
              setField("agentKey", event.currentTarget.value);
            }}
          />
          <Input
            label="Name"
            value={form.name}
            onChange={(event) => {
              setField("name", event.currentTarget.value);
            }}
          />
          <Select
            label="Tone"
            value={form.tone}
            onChange={(event) => {
              setField("tone", event.currentTarget.value);
            }}
          >
            {PERSONA_TONES.map((toneOption: string) => (
              <option key={toneOption} value={toneOption}>
                {toneOption}
              </option>
            ))}
          </Select>
        </div>
      </FieldGroup>

      <FieldGroup title="Model" description="Primary model assignment and fallbacks.">
        <AgentEditorModelFields
          model={form.model}
          variant={form.variant}
          fallbacks={form.fallbacks}
          setField={setField}
          presets={modelPresets}
          presetsLoading={modelPresetsLoading}
          presetsError={modelPresetsError}
          selectedPrimaryPreset={selectedPrimaryPreset}
          legacyPrimarySelection={legacyPrimarySelection}
          onSelectPrimaryPreset={onSelectPrimaryPreset}
          onClearPrimaryModel={onClearPrimaryModel}
        />
        {unsupportedModelOptions ? (
          <div className="grid gap-1">
            <span className="text-sm font-medium text-fg">Existing model options</span>
            <StructuredValue value={preservedModelOptionsRaw} />
          </div>
        ) : null}
      </FieldGroup>

      <FieldGroup
        title="Skills"
        description="Workspace, bundled, user, and managed skills available to this agent."
      >
        <ToggleField
          label="Trust workspace skills"
          checked={form.workspaceSkillsTrusted}
          onCheckedChange={(checked) => {
            setField("workspaceSkillsTrusted", checked);
          }}
        />
        <AccessTransferField
          title="skills"
          defaultLabel="Default for new skills"
          helperText={
            capabilitiesError
              ? capabilitiesError
              : capabilitiesLoading
                ? "Loading discoverable skills..."
                : "New skills follow the selected default automatically."
          }
          items={(capabilities?.skills.items ?? []).map((item: { id: string; name: string }) => ({
            id: item.id,
            label: `${item.name} (${item.id})`,
          }))}
          state={{
            defaultMode: form.skillsDefaultMode,
            allow: form.skillsAllow,
            deny: form.skillsDeny,
          }}
          disabled={capabilitiesLoading}
          onDefaultModeChange={(modeValue) => {
            setField("skillsDefaultMode", modeValue);
            if (modeValue === "allow") {
              setField("skillsAllow", []);
            } else {
              setField("skillsDeny", []);
            }
          }}
          onAllowChange={(ids) => {
            setField("skillsAllow", ids);
          }}
          onDenyChange={(ids) => {
            setField("skillsDeny", ids);
          }}
        />
      </FieldGroup>

      <FieldGroup
        title="MCP"
        description="Enabled MCP servers follow the selected default for new discoveries."
      >
        <AccessTransferField
          title="mcp"
          defaultLabel="Default for new MCP servers"
          helperText={
            capabilitiesError
              ? capabilitiesError
              : capabilitiesLoading
                ? "Loading discoverable MCP servers..."
                : "New MCP servers follow the selected default automatically."
          }
          items={(capabilities?.mcp.items ?? []).map((item: { id: string; name: string }) => ({
            id: item.id,
            label: `${item.name} (${item.id})`,
          }))}
          state={{
            defaultMode: form.mcpDefaultMode,
            allow: form.mcpAllow,
            deny: form.mcpDeny,
          }}
          disabled={capabilitiesLoading}
          onDefaultModeChange={(modeValue) => {
            setField("mcpDefaultMode", modeValue);
            if (modeValue === "allow") {
              setField("mcpAllow", []);
            } else {
              setField("mcpDeny", []);
            }
          }}
          onAllowChange={(ids) => {
            setField("mcpAllow", ids);
          }}
          onDenyChange={(ids) => {
            setField("mcpDeny", ids);
          }}
        />
        <AgentEditorMcpOverrides
          items={mcpSettingsItems}
          detailsById={mcpExtensionDetailsById}
          explicitServerSettings={mcpExplicitServerSettings}
          loading={mcpExtensionsLoading}
          error={mcpExtensionsError}
          drafts={mcpSettingsDrafts}
          onDraftChange={onMcpSettingsDraftChange}
        />
      </FieldGroup>

      <FieldGroup
        title="Tools"
        description="Builtin, MCP, and plugin tools available to this agent."
      >
        <AccessTransferField
          title="tools"
          defaultLabel="Default for new tools"
          helperText={
            capabilitiesError
              ? capabilitiesError
              : capabilitiesLoading
                ? "Loading discoverable tools..."
                : "New tools follow the selected default automatically."
          }
          items={(capabilities?.tools.items ?? []).map((item: { id: string }) => ({
            id: item.id,
            label: item.id,
          }))}
          state={{
            defaultMode: form.toolsDefaultMode,
            allow: form.toolsAllow,
            deny: form.toolsDeny,
          }}
          disabled={capabilitiesLoading}
          onDefaultModeChange={(modeValue) => {
            setField("toolsDefaultMode", modeValue);
            if (modeValue === "allow") {
              setField("toolsAllow", []);
            } else {
              setField("toolsDeny", []);
            }
          }}
          onAllowChange={(ids) => {
            setField("toolsAllow", ids);
          }}
          onDenyChange={(ids) => {
            setField("toolsDeny", ids);
          }}
        />
      </FieldGroup>

      <FieldGroup title="Sessions" description="Session retention, pruning, and loop controls.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="TTL days"
            value={form.ttlDays}
            onChange={(event) => setField("ttlDays", event.currentTarget.value)}
          />
          <Input
            label="Max turns"
            value={form.maxTurns}
            onChange={(event) => setField("maxTurns", event.currentTarget.value)}
          />
          <Input
            label="Context max messages"
            value={form.pruningMaxMessages}
            onChange={(event) => setField("pruningMaxMessages", event.currentTarget.value)}
          />
          <Input
            label="Tool prune keep"
            value={form.pruningToolKeep}
            onChange={(event) => setField("pruningToolKeep", event.currentTarget.value)}
          />
        </div>
        <details className="group/loop-details">
          <summary className="cursor-pointer list-none text-sm font-medium text-fg-muted hover:text-fg [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-1.5">
              <ChevronRight className="h-3.5 w-3.5 transition-transform group-open/loop-details:rotate-90" />
              Loop detection parameters
            </span>
          </summary>
          <div className="mt-3 grid gap-4 lg:grid-cols-2">
            <div className="grid gap-3 rounded-lg border border-border/70 p-3">
              <ToggleField
                label="Enable within-turn loop detection"
                checked={form.withinTurnEnabled}
                onCheckedChange={(checked) => setField("withinTurnEnabled", checked)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Consecutive repeat limit"
                  value={form.withinTurnConsecutiveLimit}
                  onChange={(event) =>
                    setField("withinTurnConsecutiveLimit", event.currentTarget.value)
                  }
                />
                <Input
                  label="Cycle repeat limit"
                  value={form.withinTurnCycleLimit}
                  onChange={(event) => setField("withinTurnCycleLimit", event.currentTarget.value)}
                />
              </div>
            </div>
            <div className="grid gap-3 rounded-lg border border-border/70 p-3">
              <ToggleField
                label="Enable cross-turn loop detection"
                checked={form.crossTurnEnabled}
                onCheckedChange={(checked) => setField("crossTurnEnabled", checked)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Window assistant messages"
                  value={form.crossTurnWindowMessages}
                  onChange={(event) =>
                    setField("crossTurnWindowMessages", event.currentTarget.value)
                  }
                />
                <Input
                  label="Similarity threshold"
                  value={form.crossTurnSimilarityThreshold}
                  onChange={(event) =>
                    setField("crossTurnSimilarityThreshold", event.currentTarget.value)
                  }
                />
                <Input
                  label="Minimum chars"
                  value={form.crossTurnMinChars}
                  onChange={(event) => setField("crossTurnMinChars", event.currentTarget.value)}
                />
                <Input
                  label="Cooldown assistant messages"
                  value={form.crossTurnCooldownMessages}
                  onChange={(event) =>
                    setField("crossTurnCooldownMessages", event.currentTarget.value)
                  }
                />
              </div>
            </div>
          </div>
        </details>
      </FieldGroup>

      <FieldGroup title="Memory" description="Memory retrieval and budget controls.">
        <Select
          label="Memory settings mode"
          value={form.memorySettingsMode}
          onChange={(event) =>
            onMemorySettingsModeChange(
              event.currentTarget.value as AgentEditorFormState["memorySettingsMode"],
            )
          }
          helperText={
            memorySharedDefaultAvailable
              ? `Shared default available from the ${effectiveSourceLabel(memoryDetail)} memory server.`
              : "No shared default memory settings are configured."
          }
        >
          <option value="inherit">Inherit shared default</option>
          <option value="override">Override for this agent</option>
        </Select>
        {form.memorySettingsMode === "inherit" ? (
          <div className="text-sm text-fg-muted">
            This agent will use the shared memory settings until you switch back to override mode.
          </div>
        ) : null}
        {form.memorySettingsMode === "override" ? (
          <MemorySettingsFields form={form} setField={setField} />
        ) : null}
      </FieldGroup>
    </>
  );
}
