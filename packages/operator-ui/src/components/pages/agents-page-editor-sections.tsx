import * as React from "react";
import type { AgentEditorFormState, AgentEditorSetField } from "./agents-page-editor-form.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Checkbox } from "../ui/checkbox.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";

function FieldGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2.5">
        <div className="text-sm font-medium text-fg">{title}</div>
        <div className="text-sm text-fg-muted">{description}</div>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

function ToggleField({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-fg">
      <Checkbox
        checked={checked}
        onCheckedChange={(nextChecked) => {
          onCheckedChange(Boolean(nextChecked));
        }}
      />
      <span>{label}</span>
    </label>
  );
}

function BudgetInputs({
  prefix,
  itemsValue,
  charsValue,
  tokensValue,
  onChange,
}: {
  prefix: string;
  itemsValue: string;
  charsValue: string;
  tokensValue: string;
  onChange: (field: string, value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Input
        label={`${prefix} items`}
        value={itemsValue}
        onChange={(event) => {
          onChange("items", event.currentTarget.value);
        }}
      />
      <Input
        label={`${prefix} chars`}
        value={charsValue}
        onChange={(event) => {
          onChange("chars", event.currentTarget.value);
        }}
      />
      <Input
        label={`${prefix} tokens`}
        value={tokensValue}
        helperText="Leave blank to keep unset."
        onChange={(event) => {
          onChange("tokens", event.currentTarget.value);
        }}
      />
    </div>
  );
}

export function AgentEditorSections({
  form,
  mode,
  setField,
  unsupportedModelOptions,
}: {
  form: AgentEditorFormState;
  mode: "create" | "edit";
  setField: AgentEditorSetField;
  unsupportedModelOptions: string | null;
}) {
  return (
    <>
      <FieldGroup
        title="Profile"
        description="Operator-facing identity and authored instructions for this agent."
      >
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
          <Input
            label="Tone"
            value={form.tone}
            onChange={(event) => {
              setField("tone", event.currentTarget.value);
            }}
          />
          <Input
            label="Palette"
            value={form.palette}
            onChange={(event) => {
              setField("palette", event.currentTarget.value);
            }}
          />
          <Input
            label="Character"
            value={form.character}
            onChange={(event) => {
              setField("character", event.currentTarget.value);
            }}
          />
          <Input
            label="Emoji"
            value={form.emoji}
            onChange={(event) => {
              setField("emoji", event.currentTarget.value);
            }}
          />
          <Input
            label="Verbosity"
            value={form.verbosity}
            onChange={(event) => {
              setField("verbosity", event.currentTarget.value);
            }}
          />
          <Input
            label="Format"
            value={form.format}
            onChange={(event) => {
              setField("format", event.currentTarget.value);
            }}
          />
        </div>
        <Textarea
          label="Description"
          rows={3}
          value={form.description}
          onChange={(event) => {
            setField("description", event.currentTarget.value);
          }}
        />
        <Textarea
          label="Identity body"
          rows={8}
          value={form.identityBody}
          onChange={(event) => {
            setField("identityBody", event.currentTarget.value);
          }}
        />
      </FieldGroup>

      <FieldGroup title="Model" description="Primary model assignment and fallbacks.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Primary model"
            value={form.model}
            onChange={(event) => {
              setField("model", event.currentTarget.value);
            }}
          />
          <Input
            label="Variant"
            value={form.variant}
            onChange={(event) => {
              setField("variant", event.currentTarget.value);
            }}
          />
        </div>
        <Textarea
          label="Fallback models"
          rows={4}
          helperText="One model per line."
          value={form.fallbacks}
          onChange={(event) => {
            setField("fallbacks", event.currentTarget.value);
          }}
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

      <FieldGroup title="Skills and Tools" description="Enabled runtime capabilities.">
        <ToggleField
          label="Trust workspace skills"
          checked={form.workspaceSkillsTrusted}
          onCheckedChange={(checked) => {
            setField("workspaceSkillsTrusted", checked);
          }}
        />
        <Textarea
          label="Enabled skills"
          rows={4}
          helperText="One skill ID per line."
          value={form.skillsEnabled}
          onChange={(event) => {
            setField("skillsEnabled", event.currentTarget.value);
          }}
        />
        <Textarea
          label="Enabled MCP servers"
          rows={4}
          helperText="One MCP server ID per line."
          value={form.mcpEnabled}
          onChange={(event) => {
            setField("mcpEnabled", event.currentTarget.value);
          }}
        />
        <Textarea
          label="Allowed tools"
          rows={4}
          helperText="One tool pattern per line."
          value={form.toolsAllowed}
          onChange={(event) => {
            setField("toolsAllowed", event.currentTarget.value);
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
