import type { ScheduleRecord } from "@tyrum/contracts";
import { CalendarClock, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useApiAction } from "../../hooks/use-api-action.js";
import { useReconnectScrollArea } from "../../reconnect-ui-state.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import type { OperatorCore } from "@tyrum/operator-app";
import { AppPage } from "../layout/app-page.js";
import { Alert } from "../ui/alert.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { ConfirmDangerDialog } from "../ui/confirm-danger-dialog.js";
import { EmptyState } from "../ui/empty-state.js";
import {
  useAdminHttpClient,
  useAdminMutationAccess,
  useAdminMutationHttpClient,
} from "./admin-http-shared.js";
import { sortSchedules } from "./schedules-page.lib.js";
import { CreateSchedulePanel, ScheduleCard } from "./schedules-page.sections.js";

export function SchedulesPage({ core }: { core: OperatorCore }) {
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleRecord | null>(null);
  const [toggleTargetId, setToggleTargetId] = useState<string | null>(null);

  const readApi = useAdminHttpClient().schedules;
  const mutationHttp = useAdminMutationHttpClient();
  const { canMutate, requestEnter } = useAdminMutationAccess(core);
  const createAction = useApiAction<ScheduleRecord>();
  const toggleAction = useApiAction<ScheduleRecord>();
  const deleteAction = useApiAction<void>();
  const scrollAreaRef = useReconnectScrollArea("schedules:page");

  const sortedSchedules = useMemo(() => sortSchedules(schedules), [schedules]);
  const enabledCount = useMemo(() => schedules.filter((s) => s.enabled).length, [schedules]);

  function requireMutationApi() {
    if (!mutationHttp?.schedules) {
      throw new Error("Admin access is required to manage schedules.");
    }
    return mutationHttp.schedules;
  }

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await readApi.list();
        if (cancelled) return;
        setSchedules(response.schedules);
      } catch (nextError) {
        if (!cancelled) {
          setError(formatErrorMessage(nextError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [readApi, refreshNonce]);

  function handlePauseResume(schedule: ScheduleRecord) {
    setToggleTargetId(schedule.schedule_id);
    void toggleAction
      .run(async () => {
        const api = requireMutationApi();
        const response = schedule.enabled
          ? await api.pause(schedule.schedule_id)
          : await api.resume(schedule.schedule_id);
        setSchedules((current) =>
          current.map((s) =>
            s.schedule_id === response.schedule.schedule_id ? response.schedule : s,
          ),
        );
        return response.schedule;
      })
      .finally(() => {
        setToggleTargetId((current) => (current === schedule.schedule_id ? null : current));
      });
  }

  return (
    <AppPage
      contentClassName="max-w-5xl gap-4"
      data-testid="schedules-page"
      scrollAreaRef={scrollAreaRef}
    >
      {/* Header card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 text-base font-semibold text-fg">
            <CalendarClock className="h-4 w-4" />
            Automation Schedules
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="text-sm text-fg-muted">
            Manage recurring automation schedules. Schedules trigger agent turns, playbooks, or
            action steps on a fixed interval or cron expression.
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{`${String(schedules.length)} schedule${schedules.length === 1 ? "" : "s"}`}</Badge>
            <Badge variant="outline">{`${String(enabledCount)} enabled`}</Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              isLoading={loading}
              onClick={() => setRefreshNonce((n) => n + 1)}
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
          {error ? (
            <Alert
              variant="error"
              title="Failed to load schedules"
              description={error}
              onDismiss={() => setError(null)}
            />
          ) : null}
        </CardContent>
      </Card>

      {/* Create panel */}
      <CreateSchedulePanel
        open={createOpen}
        onToggle={() => setCreateOpen((o) => !o)}
        canMutate={canMutate}
        requestEnter={requestEnter}
        isLoading={createAction.isLoading}
        onCreate={(input) => {
          void createAction.run(async () => {
            const response = await requireMutationApi().create(input);
            setSchedules((current) => [...current, response.schedule]);
            setCreateOpen(false);
            return response.schedule;
          });
        }}
      />

      {createAction.state.status === "error" ? (
        <Alert
          variant="error"
          title="Failed to create schedule"
          description={formatErrorMessage(createAction.state.error)}
          onDismiss={() => createAction.reset()}
        />
      ) : null}
      {toggleAction.state.status === "error" ? (
        <Alert
          variant="error"
          title="Schedule action failed"
          description={formatErrorMessage(toggleAction.state.error)}
          onDismiss={() => toggleAction.reset()}
        />
      ) : null}
      {deleteAction.state.status === "error" ? (
        <Alert
          variant="error"
          title="Schedule deletion failed"
          description={formatErrorMessage(deleteAction.state.error)}
          onDismiss={() => deleteAction.reset()}
        />
      ) : null}

      {/* Schedule list */}
      {loading && schedules.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-fg-muted">
            Loading schedules...
          </CardContent>
        </Card>
      ) : sortedSchedules.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No schedules"
          description="Create a schedule to automate recurring agent work."
          action={{
            label: "Create schedule",
            onClick: () => setCreateOpen(true),
          }}
        />
      ) : (
        <div className="grid gap-3">
          {sortedSchedules.map((schedule) => (
            <ScheduleCard
              key={schedule.schedule_id}
              schedule={schedule}
              isExpanded={expandedId === schedule.schedule_id}
              isLoading={
                (toggleAction.isLoading && toggleTargetId === schedule.schedule_id) ||
                (deleteAction.isLoading && deleteTarget?.schedule_id === schedule.schedule_id)
              }
              canMutate={canMutate}
              requestEnter={requestEnter}
              onToggleExpand={() =>
                setExpandedId((current) =>
                  current === schedule.schedule_id ? null : schedule.schedule_id,
                )
              }
              onPauseResume={() => handlePauseResume(schedule)}
              onDelete={() => setDeleteTarget(schedule)}
            />
          ))}
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmDangerDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete schedule"
        description={`This will permanently delete the schedule for ${deleteTarget?.target_scope.agent_key ?? "this agent"}. This action cannot be undone.`}
        confirmLabel="Delete schedule"
        isLoading={deleteAction.isLoading}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteAction.runAndThrow(async () => {
            await requireMutationApi().remove(deleteTarget.schedule_id);
            setSchedules((current) =>
              current.filter((s) => s.schedule_id !== deleteTarget.schedule_id),
            );
            setDeleteTarget(null);
          });
        }}
      />
    </AppPage>
  );
}
