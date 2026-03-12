import type { AgentCapabilitiesResponse } from "@tyrum/schemas";
import { PERSONA_CHARACTERS, PERSONA_PALETTES, PERSONA_TONES } from "@tyrum/schemas";
import type { AgentEditorFormState, AgentEditorSetField } from "./agents-page-editor-form.js";
import { AccessTransferField } from "./agents-page-editor-access-transfer.js";
import type { ModelPreset } from "./admin-http-models.shared.js";
import { AgentEditorModelFields } from "./agents-page-editor-models.js";
import { BudgetInputs, FieldGroup, ToggleField } from "./agents-page-editor-shared.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Textarea } from "../ui/textarea.js";

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
}) {
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
            {PERSONA_TONES.map((tone) => (
              <option key={tone} value={tone}>
                {tone}
              </option>
            ))}
          </Select>
          <Select
            label="Palette"
            value={form.palette}
            onChange={(event) => {
              setField("palette", event.currentTarget.value);
            }}
          >
            {PERSONA_PALETTES.map((palette) => (
              <option key={palette} value={palette}>
                {palette}
              </option>
            ))}
          </Select>
          <Select
            label="Character"
            value={form.character}
            onChange={(event) => {
              setField("character", event.currentTarget.value);
            }}
          >
            {PERSONA_CHARACTERS.map((character) => (
              <option key={character} value={character}>
                {character}
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
          <Textarea
            label="Existing model options"
            value={unsupportedModelOptions}
            readOnly
            rows={6}
          />
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
          items={(capabilities?.skills.items ?? []).map((item) => ({
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
          items={(capabilities?.mcp.items ?? []).map((item) => ({
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
          items={(capabilities?.tools.items ?? []).map((item) => ({
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
        <div className="grid gap-4 lg:grid-cols-2">
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
                onChange={(event) => setField("crossTurnWindowMessages", event.currentTarget.value)}
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
      </FieldGroup>

      <FieldGroup title="Memory" description="Memory retrieval and budget controls.">
        <ToggleField
          label="Enable memory"
          checked={form.memoryEnabled}
          onCheckedChange={(checked) => setField("memoryEnabled", checked)}
        />
        <div className="grid gap-2">
          <div className="text-sm font-medium text-fg">Allowed sensitivities</div>
          <div className="flex flex-wrap gap-4">
            <ToggleField
              label="Public"
              checked={form.allowPublic}
              onCheckedChange={(checked) => setField("allowPublic", checked)}
            />
            <ToggleField
              label="Private"
              checked={form.allowPrivate}
              onCheckedChange={(checked) => setField("allowPrivate", checked)}
            />
            <ToggleField
              label="Sensitive"
              checked={form.allowSensitive}
              onCheckedChange={(checked) => setField("allowSensitive", checked)}
            />
          </div>
        </div>
        <Textarea
          label="Structured fact keys"
          rows={3}
          helperText="One fact key per line."
          value={form.factKeys}
          onChange={(event) => setField("factKeys", event.currentTarget.value)}
        />
        <Textarea
          label="Structured tags"
          rows={3}
          helperText="One tag per line."
          value={form.memoryTags}
          onChange={(event) => setField("memoryTags", event.currentTarget.value)}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid gap-3 rounded-lg border border-border/70 p-3">
            <ToggleField
              label="Enable keyword retrieval"
              checked={form.keywordEnabled}
              onCheckedChange={(checked) => setField("keywordEnabled", checked)}
            />
            <Input
              label="Keyword limit"
              value={form.keywordLimit}
              onChange={(event) => setField("keywordLimit", event.currentTarget.value)}
            />
          </div>
          <div className="grid gap-3 rounded-lg border border-border/70 p-3">
            <ToggleField
              label="Enable semantic retrieval"
              checked={form.semanticEnabled}
              onCheckedChange={(checked) => setField("semanticEnabled", checked)}
            />
            <Input
              label="Semantic limit"
              value={form.semanticLimit}
              onChange={(event) => setField("semanticLimit", event.currentTarget.value)}
            />
          </div>
        </div>
        <BudgetInputs
          prefix="Total budget"
          itemsValue={form.totalItems}
          charsValue={form.totalChars}
          tokensValue={form.totalTokens}
          onChange={(field, value) => {
            if (field === "items") setField("totalItems", value);
            if (field === "chars") setField("totalChars", value);
            if (field === "tokens") setField("totalTokens", value);
          }}
        />
        <BudgetInputs
          prefix="Fact budget"
          itemsValue={form.factItems}
          charsValue={form.factChars}
          tokensValue={form.factTokens}
          onChange={(field, value) => {
            if (field === "items") setField("factItems", value);
            if (field === "chars") setField("factChars", value);
            if (field === "tokens") setField("factTokens", value);
          }}
        />
        <BudgetInputs
          prefix="Note budget"
          itemsValue={form.noteItems}
          charsValue={form.noteChars}
          tokensValue={form.noteTokens}
          onChange={(field, value) => {
            if (field === "items") setField("noteItems", value);
            if (field === "chars") setField("noteChars", value);
            if (field === "tokens") setField("noteTokens", value);
          }}
        />
        <BudgetInputs
          prefix="Procedure budget"
          itemsValue={form.procedureItems}
          charsValue={form.procedureChars}
          tokensValue={form.procedureTokens}
          onChange={(field, value) => {
            if (field === "items") setField("procedureItems", value);
            if (field === "chars") setField("procedureChars", value);
            if (field === "tokens") setField("procedureTokens", value);
          }}
        />
        <BudgetInputs
          prefix="Episode budget"
          itemsValue={form.episodeItems}
          charsValue={form.episodeChars}
          tokensValue={form.episodeTokens}
          onChange={(field, value) => {
            if (field === "items") setField("episodeItems", value);
            if (field === "chars") setField("episodeChars", value);
            if (field === "tokens") setField("episodeTokens", value);
          }}
        />
      </FieldGroup>
    </>
  );
}
