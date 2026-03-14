import type { AgentEditorFormState } from "./agents-page-editor-form.js";
import { BudgetInputs, ToggleField } from "./agents-page-editor-shared.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";

type MemoryFieldKey = keyof AgentEditorFormState;

export function MemorySettingsFields({
  form,
  setField,
}: {
  form: AgentEditorFormState;
  setField: <K extends MemoryFieldKey>(key: K, value: AgentEditorFormState[K]) => void;
}) {
  return (
    <>
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
    </>
  );
}
