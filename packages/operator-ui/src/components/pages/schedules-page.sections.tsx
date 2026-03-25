import type {
  ScheduleCadence,
  ScheduleDeliveryMode,
  ScheduleExecution,
  ScheduleKind,
  ScheduleRecord,
} from "@tyrum/contracts";
import { CalendarClock, ChevronDown, ChevronRight, Plus, Timer, Trash2 } from "lucide-react";
import { useState } from "react";
import { translateString, useI18n, useTranslateNode } from "../../i18n-helpers.js";
import { formatRelativeTime } from "../../utils/format-relative-time.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import { Select } from "../ui/select.js";
import { Separator } from "../ui/separator.js";
import { Switch } from "../ui/switch.js";
import { Textarea } from "../ui/textarea.js";
import {
  cadenceUnitToMs,
  describeExecution,
  formatAbsoluteTime,
  formatCadence,
  type CadenceUnit,
} from "./schedules-page.lib.js";

// ---------------------------------------------------------------------------
// ScheduleCard
// ---------------------------------------------------------------------------

export function ScheduleCard({
  schedule,
  isExpanded,
  isToggleLoading,
  isToggleDisabled,
  isDeleteDisabled,
  canMutate,
  requestEnter,
  onToggleExpand,
  onPauseResume,
  onDelete,
}: {
  schedule: ScheduleRecord;
  isExpanded: boolean;
  isToggleLoading: boolean;
  isToggleDisabled: boolean;
  isDeleteDisabled: boolean;
  canMutate: boolean;
  requestEnter: () => void;
  onToggleExpand: () => void;
  onPauseResume: () => void;
  onDelete: () => void;
}) {
  const intl = useI18n();
  const kindIcon = schedule.kind === "cron" ? CalendarClock : Timer;
  const KindIcon = kindIcon;
  const scheduleTestId = schedule.schedule_id;

  return (
    <Card data-testid={`schedule-card-${scheduleTestId}`}>
      <CardContent className="grid gap-4 pt-6">
        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <KindIcon className="h-4 w-4 text-fg-muted" />
              <div className="text-sm font-semibold text-fg">
                {schedule.target_scope.agent_key}
                {schedule.target_scope.workspace_key
                  ? ` / ${schedule.target_scope.workspace_key}`
                  : ""}
              </div>
              <Badge variant="outline">{schedule.kind}</Badge>
              <Badge variant={schedule.enabled ? "success" : "outline"}>
                {schedule.enabled ? "enabled" : "paused"}
              </Badge>
              <Badge variant="outline">{schedule.delivery.mode}</Badge>
              {schedule.seeded_default ? <Badge variant="outline">default</Badge> : null}
            </div>

            <div className="text-sm text-fg-muted">{formatCadence(intl, schedule.cadence)}</div>
            <div className="text-sm text-fg-muted">
              {describeExecution(intl, schedule.execution)}
            </div>

            <div className="flex flex-wrap gap-3 text-xs text-fg-muted">
              {schedule.last_fired_at ? (
                <span>
                  {translateString(intl, "Last fired: {time}", {
                    time: formatRelativeTime(schedule.last_fired_at),
                  })}
                </span>
              ) : (
                <span>{translateString(intl, "Never fired")}</span>
              )}
              {schedule.next_fire_at ? (
                <span>
                  {translateString(intl, "Next: {time}", {
                    time: formatRelativeTime(schedule.next_fire_at),
                  })}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-fg-muted">
                {schedule.enabled
                  ? translateString(intl, "Enabled")
                  : translateString(intl, "Paused")}
              </Label>
              <Switch
                data-testid={`schedule-toggle-${scheduleTestId}`}
                checked={schedule.enabled}
                aria-busy={isToggleLoading || undefined}
                disabled={isToggleDisabled}
                onCheckedChange={() => {
                  if (!canMutate) {
                    requestEnter();
                    return;
                  }
                  onPauseResume();
                }}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              data-testid={`schedule-details-${scheduleTestId}`}
              aria-expanded={isExpanded}
              onClick={onToggleExpand}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              {isExpanded ? translateString(intl, "Collapse") : translateString(intl, "Details")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              aria-label="Delete schedule"
              data-testid={`schedule-delete-${scheduleTestId}`}
              disabled={isDeleteDisabled}
              onClick={() => {
                if (!canMutate) {
                  requestEnter();
                  return;
                }
                onDelete();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Expanded detail */}
        {isExpanded ? (
          <div className="grid gap-3 rounded-lg border border-border/80 bg-bg-subtle/50 p-3">
            <DetailSection label="Schedule ID">
              <code className="text-xs">{schedule.schedule_id}</code>
            </DetailSection>
            <DetailSection label="Watcher key">
              <code className="text-xs">{schedule.watcher_key}</code>
            </DetailSection>

            <Separator />

            <DetailSection label="Cadence">
              {schedule.cadence.type === "interval" ? (
                <span className="text-sm text-fg">
                  Interval: {formatCadence(intl, schedule.cadence)}
                </span>
              ) : (
                <div className="grid gap-1 text-sm text-fg">
                  <span>Expression: {schedule.cadence.expression}</span>
                  <span>Timezone: {schedule.cadence.timezone}</span>
                </div>
              )}
            </DetailSection>

            <DetailSection label="Execution">
              <div className="grid gap-1 text-sm text-fg">
                <span>Type: {schedule.execution.kind}</span>
                {schedule.execution.kind === "agent_turn" && schedule.execution.instruction ? (
                  <div className="rounded-md border border-border/70 bg-bg px-3 py-2 text-xs">
                    {schedule.execution.instruction}
                  </div>
                ) : null}
                {schedule.execution.kind === "playbook" ? (
                  <span>Playbook: {schedule.execution.playbook_id}</span>
                ) : null}
                {schedule.execution.kind === "steps" ? (
                  <span>{schedule.execution.steps.length} action steps</span>
                ) : null}
              </div>
            </DetailSection>

            <DetailSection label="Delivery mode">
              <span className="text-sm text-fg">{schedule.delivery.mode}</span>
            </DetailSection>

            <Separator />

            <DetailSection label="Timestamps">
              <div className="grid gap-1 text-xs text-fg-muted">
                <span>Created: {formatAbsoluteTime(intl, schedule.created_at)}</span>
                <span>Updated: {formatAbsoluteTime(intl, schedule.updated_at)}</span>
                <span>
                  Last fired:{" "}
                  {schedule.last_fired_at
                    ? formatAbsoluteTime(intl, schedule.last_fired_at)
                    : "never"}
                </span>
                <span>
                  Next fire:{" "}
                  {schedule.next_fire_at ? formatAbsoluteTime(intl, schedule.next_fire_at) : "—"}
                </span>
              </div>
            </DetailSection>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DetailSection({ label, children }: { label: string; children: React.ReactNode }) {
  const translateNode = useTranslateNode();
  return (
    <div className="grid gap-1">
      <div className="text-xs font-medium text-fg-muted">{translateNode(label)}</div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateSchedulePanel
// ---------------------------------------------------------------------------

type CreateFormState = {
  kind: ScheduleKind;
  enabled: boolean;
  // interval cadence
  intervalValue: string;
  intervalUnit: CadenceUnit;
  // cron cadence
  cronExpression: string;
  cronTimezone: string;
  // execution
  executionKind: ScheduleExecution["kind"];
  instruction: string;
  playbookId: string;
  // delivery
  deliveryMode: ScheduleDeliveryMode;
  // scope
  agentKey: string;
  workspaceKey: string;
};

const INITIAL_FORM: CreateFormState = {
  kind: "heartbeat",
  enabled: true,
  intervalValue: "30",
  intervalUnit: "minutes",
  cronExpression: "",
  cronTimezone: "UTC",
  executionKind: "agent_turn",
  instruction: "",
  playbookId: "",
  deliveryMode: "quiet",
  agentKey: "",
  workspaceKey: "",
};

export function CreateSchedulePanel({
  open,
  onToggle,
  canMutate,
  requestEnter,
  isLoading,
  onCreate,
}: {
  open: boolean;
  onToggle: () => void;
  canMutate: boolean;
  requestEnter: () => void;
  isLoading: boolean;
  onCreate: (input: {
    kind: ScheduleKind;
    enabled: boolean;
    cadence: ScheduleCadence;
    execution: ScheduleExecution;
    delivery: { mode: ScheduleDeliveryMode };
    agent_key?: string;
    workspace_key?: string;
  }) => Promise<boolean>;
}) {
  const [form, setForm] = useState<CreateFormState>(INITIAL_FORM);

  function setField<K extends keyof CreateFormState>(key: K, value: CreateFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function buildCadence(): ScheduleCadence | null {
    if (form.kind === "heartbeat") {
      const num = Number(form.intervalValue);
      if (!Number.isFinite(num) || num <= 0) return null;
      return { type: "interval", interval_ms: cadenceUnitToMs(num, form.intervalUnit) };
    }
    if (!form.cronExpression.trim() || !form.cronTimezone.trim()) return null;
    return {
      type: "cron",
      expression: form.cronExpression.trim(),
      timezone: form.cronTimezone.trim(),
    };
  }

  function buildExecution(): ScheduleExecution | null {
    switch (form.executionKind) {
      case "agent_turn":
        return {
          kind: "agent_turn",
          ...(form.instruction.trim() ? { instruction: form.instruction.trim() } : undefined),
        };
      case "playbook":
        if (!form.playbookId.trim()) return null;
        return { kind: "playbook", playbook_id: form.playbookId.trim() };
      case "steps":
        return null;
    }
  }

  async function handleSubmit() {
    if (!canMutate) {
      requestEnter();
      return;
    }
    const cadence = buildCadence();
    const execution = buildExecution();
    if (!cadence || !execution) return;

    const created = await onCreate({
      kind: form.kind,
      enabled: form.enabled,
      cadence,
      execution,
      delivery: { mode: form.deliveryMode },
      agent_key: form.agentKey.trim() || undefined,
      workspace_key: form.workspaceKey.trim() || undefined,
    });

    if (created) {
      setForm(INITIAL_FORM);
    }
  }

  const cadenceValid = buildCadence() !== null;
  const executionValid = buildExecution() !== null;
  const canSubmit = cadenceValid && executionValid && !isLoading;

  return (
    <Card>
      <CardHeader className="pb-0">
        <button
          type="button"
          className="flex w-full items-center gap-2 text-sm font-medium text-fg"
          onClick={onToggle}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Plus className="h-4 w-4" />
          Create Schedule
        </button>
      </CardHeader>

      {open ? (
        <CardContent className="grid gap-4 pt-4">
          {!canMutate ? (
            <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              Authorize admin access to create schedules.
            </div>
          ) : null}

          {/* Kind */}
          <Select
            label="Schedule kind"
            value={form.kind}
            onChange={(e) => setField("kind", e.currentTarget.value as ScheduleKind)}
          >
            <option value="heartbeat">Heartbeat (interval)</option>
            <option value="cron">Cron (expression)</option>
          </Select>

          {/* Cadence - interval */}
          {form.kind === "heartbeat" ? (
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Interval"
                type="number"
                min="1"
                value={form.intervalValue}
                onChange={(e) => setField("intervalValue", e.currentTarget.value)}
              />
              <Select
                label="Unit"
                value={form.intervalUnit}
                onChange={(e) => setField("intervalUnit", e.currentTarget.value as CadenceUnit)}
              >
                <option value="seconds">Seconds</option>
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </Select>
            </div>
          ) : null}

          {/* Cadence - cron */}
          {form.kind === "cron" ? (
            <div className="grid gap-3">
              <Input
                label="Cron expression"
                placeholder="0 9 * * 1-5"
                value={form.cronExpression}
                onChange={(e) => setField("cronExpression", e.currentTarget.value)}
                helperText="Standard 5-field cron: minute hour day month weekday"
              />
              <Input
                label="Timezone"
                placeholder="UTC"
                value={form.cronTimezone}
                onChange={(e) => setField("cronTimezone", e.currentTarget.value)}
                helperText="IANA timezone identifier (e.g. America/New_York, Europe/London)"
              />
            </div>
          ) : null}

          <Separator />

          {/* Execution */}
          <Select
            label="Execution type"
            value={form.executionKind}
            onChange={(e) =>
              setField("executionKind", e.currentTarget.value as ScheduleExecution["kind"])
            }
          >
            <option value="agent_turn">Agent turn</option>
            <option value="playbook">Playbook</option>
            <option value="steps">Action steps</option>
          </Select>

          {form.executionKind === "agent_turn" ? (
            <Textarea
              label="Instruction (optional)"
              placeholder="Review current work, due signals, blocked items..."
              rows={3}
              value={form.instruction}
              onChange={(e) => setField("instruction", e.currentTarget.value)}
            />
          ) : null}

          {form.executionKind === "playbook" ? (
            <Input
              label="Playbook ID"
              placeholder="daily-report"
              value={form.playbookId}
              onChange={(e) => setField("playbookId", e.currentTarget.value)}
            />
          ) : null}

          {form.executionKind === "steps" ? (
            <div className="rounded-md border border-border/70 bg-bg-subtle/50 px-3 py-2 text-sm text-fg-muted">
              Step-based schedules must be created via the API or agent tools.
            </div>
          ) : null}

          <Separator />

          {/* Delivery & scope */}
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Delivery mode"
              value={form.deliveryMode}
              onChange={(e) =>
                setField("deliveryMode", e.currentTarget.value as ScheduleDeliveryMode)
              }
            >
              <option value="quiet">Quiet</option>
              <option value="notify">Notify</option>
            </Select>

            <div className="flex items-end gap-2 pb-0.5">
              <Label className="text-sm">Enabled</Label>
              <Switch
                checked={form.enabled}
                onCheckedChange={(checked) => setField("enabled", checked)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Agent key (optional)"
              placeholder="agent-key"
              value={form.agentKey}
              onChange={(e) => setField("agentKey", e.currentTarget.value)}
            />
            <Input
              label="Workspace key (optional)"
              placeholder="workspace-key"
              value={form.workspaceKey}
              onChange={(e) => setField("workspaceKey", e.currentTarget.value)}
            />
          </div>

          <Button disabled={!canSubmit} isLoading={isLoading} onClick={handleSubmit}>
            <Plus className="h-4 w-4" />
            Create schedule
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}
