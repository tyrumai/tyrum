import type { WorkItem, OperatorCore } from "@tyrum/operator-app";
import { toWorkboardScopePayload } from "@tyrum/operator-app";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOperatorStore } from "../../use-operator-store.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { useAppShellMinWidth } from "../layout/app-shell.js";
import { AppPageToolbar } from "../layout/app-page.js";
import { Button } from "../ui/button.js";
import {
  WORK_ITEM_STATUSES,
  groupWorkItemsByStatus,
  selectTasksForSelectedWorkItem,
} from "../workboard/workboard-store.js";
import {
  WorkboardItemEditorDialog,
  type WorkboardEditorSubmitInput,
} from "./workboard-page-editor-dialog.js";
import { useWorkboardPageData } from "./workboard-page-data.js";
import { WorkboardPageLayout } from "./workboard-page-layout.js";
import { WorkboardScopeControls } from "./workboard-page-scope-controls.js";

export type WorkBoardPageProps = { core: OperatorCore; onNavigate: (id: string) => void };

const WORKBOARD_DESKTOP_BOARD_MIN_WIDTH_PX = 1120;
const WORKBOARD_DESKTOP_CONTENT_WIDTH_PX = WORKBOARD_DESKTOP_BOARD_MIN_WIDTH_PX + 40;

type PendingAction = WorkItem["status"] | "pause" | "resume" | "delete" | null;

export function WorkBoardPage({ core, onNavigate }: WorkBoardPageProps) {
  const connection = useOperatorStore(core.connectionStore);
  const isConnected = connection.status === "connected";
  const workboard = useOperatorStore(core.workboardStore);
  const currentScopeKeys = workboard.scopeKeys;
  const effectiveScopeKeys = useMemo(
    () => ({
      agent_key: currentScopeKeys.agent_key,
      workspace_key: currentScopeKeys.workspace_key,
    }),
    [currentScopeKeys.agent_key, currentScopeKeys.workspace_key],
  );
  const effectiveScopePayload = useMemo(
    () => toWorkboardScopePayload(effectiveScopeKeys),
    [effectiveScopeKeys],
  );
  const desktopBoard = useAppShellMinWidth(WORKBOARD_DESKTOP_CONTENT_WIDTH_PX);

  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<(typeof WORK_ITEM_STATUSES)[number]>(
    WORK_ITEM_STATUSES[0],
  );
  const [workboardErrorDismissed, setWorkboardErrorDismissed] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editorBusy, setEditorBusy] = useState<"create" | "edit" | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  useEffect(() => {
    setWorkboardErrorDismissed(false);
  }, [workboard.error]);

  useEffect(() => {
    setSelectedWorkItemId(null);
  }, [effectiveScopeKeys.agent_key, effectiveScopeKeys.workspace_key]);

  const {
    selectedItem,
    setSelectedItem,
    artifacts,
    setArtifacts,
    decisions,
    setDecisions,
    signals,
    setSignals,
    agentKvEntries,
    setAgentKvEntries,
    workItemKvEntries,
    setWorkItemKvEntries,
    drilldownBusy,
    drilldownError,
    setDrilldownError,
  } = useWorkboardPageData({
    core,
    effectiveScopeKeys,
    isConnected,
    selectedWorkItemId,
    workboardItems: workboard.items,
  });

  const grouped = useMemo(() => groupWorkItemsByStatus(workboard.items), [workboard.items]);

  useEffect(() => {
    if (selectedItem) {
      setSelectedStatus(selectedItem.status);
      return;
    }
    if (grouped[selectedStatus].length > 0) return;
    const nextStatus = WORK_ITEM_STATUSES.find((status) => grouped[status].length > 0);
    if (nextStatus && nextStatus !== selectedStatus) {
      setSelectedStatus(nextStatus);
    }
  }, [grouped, selectedItem, selectedStatus]);

  const transitionSelected = useCallback(
    async (status: WorkItem["status"], reason: string): Promise<void> => {
      if (!isConnected) return;
      if (!selectedWorkItemId) return;

      setPendingAction(status);
      setDrilldownError(null);
      try {
        const res = await core.workboard.workTransition({
          ...effectiveScopePayload,
          work_item_id: selectedWorkItemId,
          status,
          reason,
        });
        core.workboardStore.upsertWorkItem(res.item);

        setSelectedItem(res.item);
      } catch (error) {
        setDrilldownError(formatErrorMessage(error));
      } finally {
        setPendingAction(null);
      }
    },
    [core.workboard, core.workboardStore, effectiveScopePayload, isConnected, selectedWorkItemId],
  );

  const pauseSelected = useCallback(
    async (reason: string): Promise<void> => {
      if (!isConnected || !selectedWorkItemId) {
        return;
      }

      setPendingAction("pause");
      setDrilldownError(null);
      try {
        const res = await core.workboard.workPause({
          ...effectiveScopePayload,
          work_item_id: selectedWorkItemId,
          reason,
        });
        core.workboardStore.upsertWorkItem(res.item);
        setSelectedItem(res.item);
      } catch (error) {
        setDrilldownError(formatErrorMessage(error));
      } finally {
        setPendingAction(null);
      }
    },
    [core.workboard, core.workboardStore, effectiveScopePayload, isConnected, selectedWorkItemId],
  );

  const resumeSelected = useCallback(
    async (reason: string): Promise<void> => {
      if (!isConnected || !selectedWorkItemId) {
        return;
      }

      setPendingAction("resume");
      setDrilldownError(null);
      try {
        const res = await core.workboard.workResume({
          ...effectiveScopePayload,
          work_item_id: selectedWorkItemId,
          reason,
        });
        core.workboardStore.upsertWorkItem(res.item);
        setSelectedItem(res.item);
      } catch (error) {
        setDrilldownError(formatErrorMessage(error));
      } finally {
        setPendingAction(null);
      }
    },
    [core.workboard, core.workboardStore, effectiveScopePayload, isConnected, selectedWorkItemId],
  );

  const deleteSelected = useCallback(async (): Promise<void> => {
    if (!isConnected || !selectedWorkItemId) {
      return;
    }

    setPendingAction("delete");
    setDrilldownError(null);
    try {
      const res = await core.workboard.workDelete({
        ...effectiveScopePayload,
        work_item_id: selectedWorkItemId,
      });
      core.workboardStore.removeWorkItem(res.item.work_item_id);
      setSelectedWorkItemId(null);
      setSelectedItem(null);
      setArtifacts([]);
      setDecisions([]);
      setSignals([]);
      setAgentKvEntries([]);
      setWorkItemKvEntries([]);
    } catch (error) {
      setDrilldownError(formatErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  }, [core.workboard, core.workboardStore, effectiveScopePayload, isConnected, selectedWorkItemId]);

  const submitEditor = useCallback(
    async (input: WorkboardEditorSubmitInput): Promise<void> => {
      if (!isConnected) {
        return;
      }

      const mode = input.mode;
      setEditorBusy(mode);
      setEditorError(null);

      try {
        if (mode === "create") {
          const res = await core.workboard.workCreate({
            ...effectiveScopePayload,
            item: input.item,
          });
          core.workboardStore.upsertWorkItem(res.item);
          setSelectedWorkItemId(res.item.work_item_id);
          setSelectedItem(res.item);
          setCreateDialogOpen(false);
          return;
        }

        if (!selectedWorkItemId) {
          throw new Error("Select a work item before saving changes.");
        }

        const res = await core.workboard.workUpdate({
          ...effectiveScopePayload,
          work_item_id: selectedWorkItemId,
          patch: input.patch,
        });
        core.workboardStore.upsertWorkItem(res.item);
        setSelectedItem(res.item);
        setEditDialogOpen(false);
      } catch (error) {
        setEditorError(formatErrorMessage(error));
      } finally {
        setEditorBusy(null);
      }
    },
    [core.workboard, core.workboardStore, effectiveScopePayload, isConnected, selectedWorkItemId],
  );

  const tasksForSelected = selectTasksForSelectedWorkItem(
    workboard.tasksByWorkItemId,
    selectedWorkItemId,
  );
  const taskList = useMemo(() => Object.values(tasksForSelected), [tasksForSelected]);

  const taskCounts = useMemo(() => {
    const counts = { leased: 0, running: 0, paused: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const task of taskList) {
      counts[task.status] += 1;
    }
    return counts;
  }, [taskList]);

  const approvalBlockers = useMemo(
    () =>
      taskList.filter((task) => task.status === "paused" && typeof task.approval_id === "string"),
    [taskList],
  );

  const hasActiveLease = taskList.some(
    (task) => task.status === "leased" || task.status === "running",
  );
  const hasPausedTasks = taskList.some((task) => task.status === "paused");
  const canMarkReadySelected = selectedItem?.status === "backlog" && !hasActiveLease;
  const canPauseSelected = hasActiveLease;
  const canResumeSelected = hasPausedTasks;
  const canEditSelected = selectedItem !== null;
  const canDeleteSelected = selectedItem !== null;
  const canCancelSelected =
    selectedItem !== null &&
    (selectedItem.status === "ready" ||
      selectedItem.status === "doing" ||
      selectedItem.status === "blocked");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-bg">
      <AppPageToolbar
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <WorkboardScopeControls
              core={core}
              isConnected={isConnected}
              scopeKeys={effectiveScopeKeys}
              resolvedScope={workboard.resolvedScope}
            />
            <Button
              size="sm"
              onClick={() => {
                setEditorError(null);
                setCreateDialogOpen(true);
              }}
              disabled={!isConnected}
            >
              New work item
            </Button>
          </div>
        }
      />
      <WorkboardPageLayout
        desktopBoard={desktopBoard}
        grouped={grouped}
        selectedStatus={selectedStatus}
        onSelectedStatusChange={setSelectedStatus}
        selectedWorkItemId={selectedWorkItemId}
        onSelectedWorkItemIdChange={setSelectedWorkItemId}
        workboardError={workboard.error}
        workboardErrorDismissed={workboardErrorDismissed}
        onDismissWorkboardError={() => setWorkboardErrorDismissed(true)}
        selectedItem={selectedItem}
        drilldownBusy={drilldownBusy}
        drilldownError={drilldownError}
        pendingAction={pendingAction}
        canMarkReadySelected={canMarkReadySelected}
        canPauseSelected={canPauseSelected}
        canResumeSelected={canResumeSelected}
        canEditSelected={canEditSelected}
        canDeleteSelected={canDeleteSelected}
        canCancelSelected={canCancelSelected}
        isReadOnlyLocked={hasActiveLease}
        onTransition={transitionSelected}
        onPause={pauseSelected}
        onResume={resumeSelected}
        onDelete={deleteSelected}
        onEdit={() => {
          setEditorError(null);
          setEditDialogOpen(true);
        }}
        taskCounts={taskCounts}
        taskList={taskList}
        approvalBlockers={approvalBlockers}
        decisions={decisions}
        artifacts={artifacts}
        signals={signals}
        agentKvEntries={agentKvEntries}
        workItemKvEntries={workItemKvEntries}
        onNavigate={onNavigate}
      />
      <WorkboardItemEditorDialog
        open={createDialogOpen}
        mode="create"
        busy={editorBusy === "create"}
        error={editorError}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) {
            setEditorError(null);
          }
        }}
        onSubmit={submitEditor}
      />
      <WorkboardItemEditorDialog
        open={editDialogOpen}
        mode="edit"
        busy={editorBusy === "edit"}
        error={editorError}
        item={selectedItem}
        onOpenChange={(open) => {
          setEditDialogOpen(open);
          if (!open) {
            setEditorError(null);
          }
        }}
        onSubmit={submitEditor}
      />
    </div>
  );
}
