import type { OperatorCore } from "@tyrum/operator-core";
import type { ManagedAgentDetail } from "@tyrum/schemas";
import * as React from "react";
import { useApiAction } from "../../hooks/use-api-action.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";
import {
  type AgentEditorFormState,
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
  const [preservedModelOptions, setPreservedModelOptions] = React.useState<Record<string, unknown>>(
    {},
  );
  const saveAction = useApiAction<ManagedAgentDetail>();

  React.useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (mode === "create") {
        setForm(createBlankForm());
        setPreservedModelOptions({});
        setLoadError(null);
        setLoading(false);
        return;
      }
      if (!agentKey) {
        setLoadError("Select an agent to edit.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError(null);
      try {
        const detail = await core.http.agents.get(agentKey);
        if (cancelled) return;
        setForm(
          snapshotToForm({
            agentKey: detail.agent_key,
            config: detail.config,
            identity: detail.identity,
          }),
        );
        setPreservedModelOptions(detail.config.model.options ?? {});
      } catch (error) {
        if (cancelled) return;
        setLoadError(formatErrorMessage(error));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [agentKey, core.http.agents, createNonce, mode]);

  const unsupportedModelOptions =
    Object.keys(preservedModelOptions).length > 0
      ? JSON.stringify(preservedModelOptions, null, 2)
      : null;

  const setField = React.useCallback(
    <K extends keyof AgentEditorFormState>(key: K, value: AgentEditorFormState[K]) => {
      setForm((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const save = async (): Promise<void> => {
    const payload = buildPayload(form, preservedModelOptions);
    const targetKey = agentKey ?? payload.agent_key;

    if (mode === "create") {
      await saveAction.runAndThrow(async () => await core.http.agents.create(payload));
      onSaved(payload.agent_key);
      return;
    }

    await saveAction.runAndThrow(
      async () =>
        await core.http.agents.update(targetKey, {
          config: payload.config,
          identity: payload.identity,
        }),
    );
    onSaved(targetKey);
  };

  if (loadError) {
    return <Alert variant="error" title="Agent editor unavailable" description={loadError} />;
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10 text-sm text-fg-muted">Loading agent editor…</CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4" data-testid="agents-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-fg-muted">
          {mode === "create"
            ? "Create a managed agent and persist its configuration."
            : "Edit the selected agent's persisted configuration and identity."}
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

      {saveAction.error ? (
        <Alert
          variant="error"
          title="Save failed"
          description={formatErrorMessage(saveAction.error)}
        />
      ) : null}
      {unsupportedModelOptions ? (
        <Alert
          variant="info"
          title="Advanced model options preserved"
          description="This editor keeps existing provider-specific model options intact, but it does not edit them yet."
        />
      ) : null}

      <AgentEditorSections
        form={form}
        mode={mode}
        setField={setField}
        unsupportedModelOptions={unsupportedModelOptions}
      />
    </div>
  );
}
