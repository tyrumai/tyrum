import type { ObservedTelegramThread } from "@tyrum/schemas";
import * as React from "react";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Select } from "../ui/select.js";
import type { RoutingRuleDraft, RoutingRuleRow } from "./admin-http-routing-config.shared.js";

export type RoutingAgentOption = {
  key: string;
  label: string;
};

function resolveInitialDraft(input: {
  row: RoutingRuleRow | null;
  defaultAvailable: boolean;
  agents: RoutingAgentOption[];
  threads: ObservedTelegramThread[];
}): RoutingRuleDraft {
  if (input.row) {
    return {
      kind: input.row.kind,
      agentKey: input.row.agentKey,
      threadId: input.row.threadId ?? "",
    };
  }

  return {
    kind: input.defaultAvailable ? "default" : "thread",
    agentKey: input.agents[0]?.key ?? "",
    threadId: input.threads[0]?.thread_id ?? "",
  };
}

export function RoutingRuleDialog({
  open,
  onOpenChange,
  row,
  defaultAvailable,
  agents,
  observedThreads,
  onSubmit,
  canMutate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: RoutingRuleRow | null;
  defaultAvailable: boolean;
  agents: RoutingAgentOption[];
  observedThreads: ObservedTelegramThread[];
  onSubmit: (draft: RoutingRuleDraft) => Promise<void>;
  canMutate: boolean;
}): React.ReactElement {
  const [draft, setDraft] = React.useState<RoutingRuleDraft>({
    kind: "default",
    agentKey: "",
    threadId: "",
  });
  const [saving, setSaving] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const mode = row ? "edit" : "create";
  const effectiveThreads = React.useMemo(() => {
    if (!row?.threadId) return observedThreads;
    if (observedThreads.some((thread) => thread.thread_id === row.threadId)) {
      return observedThreads;
    }
    return [
      {
        channel: "telegram",
        account_key: row.accountKey ?? "default",
        thread_id: row.threadId,
        container_kind: row.containerKind ?? "group",
        ...(row.sessionTitle ? { session_title: row.sessionTitle } : {}),
        ...(row.lastActiveAt ? { last_active_at: row.lastActiveAt } : {}),
      },
      ...observedThreads,
    ];
  }, [observedThreads, row]);
  const selectedThread = effectiveThreads.find((thread) => thread.thread_id === draft.threadId);

  React.useEffect(() => {
    if (!open) return;
    setErrorMessage(null);
    setSaving(false);
    setDraft(
      resolveInitialDraft({
        row,
        defaultAvailable,
        agents,
        threads: effectiveThreads,
      }),
    );
  }, [agents, defaultAvailable, effectiveThreads, open, row]);

  const canSave =
    canMutate &&
    draft.agentKey.trim().length > 0 &&
    (draft.kind === "default" || draft.threadId.trim().length > 0);

  const submit = async (): Promise<void> => {
    if (!canMutate) {
      setErrorMessage("Enter Elevated Mode to change channels routing.");
      return;
    }
    if (!draft.agentKey.trim()) {
      setErrorMessage("Choose an agent.");
      return;
    }
    if (draft.kind === "thread" && !draft.threadId.trim()) {
      setErrorMessage("Choose a Telegram thread.");
      return;
    }

    setSaving(true);
    setErrorMessage(null);
    try {
      await onSubmit(draft);
      onOpenChange(false);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="channels-rule-dialog">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit routing rule" : "Add routing rule"}</DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Update the selected Telegram routing rule."
              : "Choose the Telegram route you want Tyrum to handle and assign it to an agent."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {mode === "create" ? (
            <Select
              label="Rule type"
              data-testid="channels-rule-kind"
              value={draft.kind}
              onChange={(event) => {
                const kind = event.currentTarget.value as RoutingRuleDraft["kind"];
                setDraft((current) => ({
                  kind,
                  agentKey: current.agentKey || agents[0]?.key || "",
                  threadId: kind === "thread" ? (effectiveThreads[0]?.thread_id ?? "") : "",
                }));
              }}
            >
              {defaultAvailable ? <option value="default">Default route</option> : null}
              <option value="thread">Thread override</option>
            </Select>
          ) : (
            <Alert
              variant="info"
              title={row?.kind === "default" ? "Default route" : "Thread override"}
              description={
                row?.kind === "default"
                  ? "This rule handles unmatched Telegram chats."
                  : row?.threadId
                    ? `This rule targets Telegram thread ${row.threadId}.`
                    : undefined
              }
            />
          )}

          {draft.kind === "thread" ? (
            <Select
              label="Telegram thread"
              data-testid="channels-rule-thread"
              value={draft.threadId}
              disabled={effectiveThreads.length === 0}
              helperText={
                effectiveThreads.length === 0
                  ? "No observed Telegram threads are available yet."
                  : "Only observed Telegram threads are selectable."
              }
              onChange={(event) => {
                setDraft((current) => ({ ...current, threadId: event.currentTarget.value }));
              }}
            >
              {effectiveThreads.length === 0 ? <option value="">No observed threads</option> : null}
              {effectiveThreads.map((thread) => (
                <option key={`${thread.account_key}:${thread.thread_id}`} value={thread.thread_id}>
                  {(thread.session_title ?? thread.thread_id) +
                    ` (${thread.container_kind}/${thread.account_key})`}
                </option>
              ))}
            </Select>
          ) : null}

          {draft.kind === "thread" && selectedThread ? (
            <Alert
              variant="info"
              title={selectedThread.session_title ?? selectedThread.thread_id}
              description={`Telegram ${selectedThread.container_kind} on account ${selectedThread.account_key}`}
            />
          ) : null}

          <Select
            label="Agent"
            data-testid="channels-rule-agent"
            value={draft.agentKey}
            disabled={agents.length === 0}
            helperText={
              agents.length === 0 ? "No agents are available for routing yet." : undefined
            }
            onChange={(event) => {
              setDraft((current) => ({ ...current, agentKey: event.currentTarget.value }));
            }}
          >
            {agents.length === 0 ? <option value="">No agents available</option> : null}
            {agents.map((agent) => (
              <option key={agent.key} value={agent.key}>
                {agent.label}
              </option>
            ))}
          </Select>

          {errorMessage ? (
            <Alert variant="error" title="Unable to save routing rule" description={errorMessage} />
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-testid="channels-rule-save"
            isLoading={saving}
            disabled={!canSave}
            onClick={() => {
              void submit();
            }}
          >
            {mode === "edit" ? "Save changes" : "Add rule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
