import type { ActivityState, ActivityWorkstream, OperatorCore } from "@tyrum/operator-core";
import {
  randomizePersona,
  type AgentConfig as AgentConfigT,
  type AgentConfigUpdateResponse as AgentConfigUpdateResponseT,
  type AgentPersona as AgentPersonaT,
  type ManagedAgentDetail,
} from "@tyrum/schemas";
import * as React from "react";
import { useApiAction } from "../../hooks/use-api-action.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";
import { compactWorkstreamKey, formatLaneLabel } from "./activity-scene-model.js";

const SAVE_REASON = "activity inspector persona update";

type ActivityPersonaPanelProps = {
  activity: ActivityState;
  core: OperatorCore;
  selectedWorkstream: ActivityWorkstream;
  onSelectWorkstream: (workstreamId: string) => void;
};

function readPersona(detail: ManagedAgentDetail): AgentPersonaT {
  return detail.config.persona ?? detail.persona;
}

function workstreamTabLabel(workstream: ActivityWorkstream): string {
  return `${formatLaneLabel(workstream.lane)} · ${compactWorkstreamKey(workstream.key)}`;
}

function collectUsedNames(activity: ActivityState, selectedAgentId: string): string[] {
  return activity.agentIds
    .filter((agentId) => agentId !== selectedAgentId)
    .map((agentId) => activity.agentsById[agentId]?.persona.name ?? "")
    .filter((name) => name.length > 0);
}

function updatePersonaField(
  current: AgentPersonaT,
  key: keyof AgentPersonaT,
  value: string,
): AgentPersonaT {
  return { ...current, [key]: value };
}

export function ActivityPersonaPanel({
  activity,
  core,
  selectedWorkstream,
  onSelectWorkstream,
}: ActivityPersonaPanelProps) {
  const [personaDraft, setPersonaDraft] = React.useState<AgentPersonaT>(selectedWorkstream.persona);
  const [baseConfig, setBaseConfig] = React.useState<AgentConfigT | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [savedRevision, setSavedRevision] = React.useState<number | null>(null);
  const saveAction = useApiAction<AgentConfigUpdateResponseT>();
  const resetSaveAction = saveAction.reset;
  const selectedAgentId = selectedWorkstream.agentId;
  const agent = activity.agentsById[selectedAgentId];
  const workstreamIds = agent?.workstreamIds ?? [selectedWorkstream.id];

  React.useEffect(() => {
    let cancelled = false;
    setPersonaDraft(selectedWorkstream.persona);
    setBaseConfig(null);
    setLoadError(null);
    setIsLoading(true);
    setSavedRevision(null);
    resetSaveAction();

    async function loadManagedAgent(): Promise<void> {
      try {
        const detail = await core.http.agents.get(selectedAgentId);
        if (cancelled) return;
        setBaseConfig(detail.config);
        setPersonaDraft(readPersona(detail));
      } catch (error) {
        if (cancelled) return;
        setLoadError(formatErrorMessage(error));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadManagedAgent();
    return () => {
      cancelled = true;
    };
  }, [core.http.agents, resetSaveAction, selectedAgentId, selectedWorkstream.persona]);

  const editorDisabled = isLoading || baseConfig === null;
  const usedNames = React.useMemo(
    () => collectUsedNames(activity, selectedAgentId),
    [activity, selectedAgentId],
  );

  const savePersona = async (): Promise<void> => {
    if (!baseConfig) return;
    try {
      const result = await saveAction.runAndThrow(async () => {
        return await core.http.agentConfig.update(selectedAgentId, {
          config: {
            ...baseConfig,
            persona: personaDraft,
          },
          reason: SAVE_REASON,
        });
      });
      setBaseConfig({
        ...result.config,
        persona: personaDraft,
      });
      setSavedRevision(result.revision);
    } catch {
      // useApiAction already exposes the save failure inline.
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/70 bg-bg-subtle/50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">
              Agent identity
            </div>
            <div className="mt-1 text-base font-semibold text-fg">{personaDraft.name}</div>
            <p className="mt-1 text-sm text-fg-muted">
              {personaDraft.description || "No persona description available."}
            </p>
          </div>
          {savedRevision ? (
            <div className="text-xs font-medium text-success">
              Saved as revision {savedRevision}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-bg-subtle/50 p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-fg-muted">Workstreams</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {workstreamIds.map((workstreamId) => {
            const workstream = activity.workstreamsById[workstreamId];
            if (!workstream) return null;
            const selected = workstreamId === selectedWorkstream.id;
            return (
              <Button
                key={workstreamId}
                type="button"
                size="sm"
                variant={selected ? "secondary" : "outline"}
                data-testid={`activity-inspector-workstream-${workstreamId}`}
                aria-pressed={selected}
                onClick={() => {
                  onSelectWorkstream(workstreamId);
                }}
              >
                {workstreamTabLabel(workstream)}
              </Button>
            );
          })}
        </div>
      </div>

      {loadError ? (
        <Alert
          variant="warning"
          title="Managed persona config unavailable"
          description={loadError}
        />
      ) : null}
      {saveAction.error ? (
        <Alert
          variant="error"
          title="Save failed"
          description={formatErrorMessage(saveAction.error)}
        />
      ) : null}

      <div className="rounded-lg border border-border/70 bg-bg-subtle/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-fg">Persona editor</div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="activity-persona-randomize"
              disabled={editorDisabled}
              onClick={() => {
                setSavedRevision(null);
                saveAction.reset();
                setPersonaDraft((current) => randomizePersona({ current, usedNames }));
              }}
            >
              Randomize
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="activity-persona-save"
              disabled={editorDisabled}
              isLoading={saveAction.isLoading}
              onClick={() => {
                setSavedRevision(null);
                void savePersona();
              }}
            >
              Save persona
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <Input
            label="Name"
            data-testid="activity-persona-name"
            value={personaDraft.name}
            disabled={editorDisabled}
            onInput={(event) => {
              setSavedRevision(null);
              saveAction.reset();
              setPersonaDraft((current) =>
                updatePersonaField(current, "name", event.currentTarget.value),
              );
            }}
          />
          <Textarea
            label="Description"
            data-testid="activity-persona-description"
            value={personaDraft.description}
            disabled={editorDisabled}
            onInput={(event) => {
              setSavedRevision(null);
              saveAction.reset();
              setPersonaDraft((current) =>
                updatePersonaField(current, "description", event.currentTarget.value),
              );
            }}
          />
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              label="Tone"
              data-testid="activity-persona-tone"
              value={personaDraft.tone}
              disabled={editorDisabled}
              onInput={(event) => {
                setSavedRevision(null);
                saveAction.reset();
                setPersonaDraft((current) =>
                  updatePersonaField(current, "tone", event.currentTarget.value),
                );
              }}
            />
            <Input
              label="Palette"
              data-testid="activity-persona-palette"
              value={personaDraft.palette}
              disabled={editorDisabled}
              onInput={(event) => {
                setSavedRevision(null);
                saveAction.reset();
                setPersonaDraft((current) =>
                  updatePersonaField(current, "palette", event.currentTarget.value),
                );
              }}
            />
            <Input
              label="Character"
              data-testid="activity-persona-character"
              value={personaDraft.character}
              disabled={editorDisabled}
              onInput={(event) => {
                setSavedRevision(null);
                saveAction.reset();
                setPersonaDraft((current) =>
                  updatePersonaField(current, "character", event.currentTarget.value),
                );
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
