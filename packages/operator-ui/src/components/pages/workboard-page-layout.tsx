import type {
  DecisionRecord,
  WorkArtifact,
  WorkItem,
  WorkSignal,
  WorkTaskSummary,
} from "@tyrum/operator-app";
import type { WorkStateKvEntry } from "../workboard/workboard-store.js";
import { useCallback, useRef } from "react";
import { Alert } from "../ui/alert.js";
import { ScrollArea } from "../ui/scroll-area.js";
import { WORK_ITEM_STATUSES } from "../workboard/workboard-store.js";
import { WorkBoardDrilldown } from "./workboard-page-drilldown.js";
import { STATUS_LABELS, WorkStatusList, WorkStatusPanel } from "./workboard-page.shared.js";

const DESKTOP_BOARD_GRID_STYLE = {
  gridTemplateColumns: `repeat(${WORK_ITEM_STATUSES.length}, minmax(0, 1fr))`,
} as const;

function tabId(status: string): string {
  return `workboard-tab-${status}`;
}

function panelId(status: string): string {
  return `workboard-panel-${status}`;
}

const WORKBOARD_DESKTOP_BOARD_MIN_WIDTH_PX = 1120;
const DESKTOP_BOARD_MIN_WIDTH_STYLE = { minWidth: WORKBOARD_DESKTOP_BOARD_MIN_WIDTH_PX } as const;

export function WorkboardPageLayout(props: {
  desktopBoard: boolean;
  grouped: Record<(typeof WORK_ITEM_STATUSES)[number], WorkItem[]>;
  selectedStatus: (typeof WORK_ITEM_STATUSES)[number];
  onSelectedStatusChange: (status: (typeof WORK_ITEM_STATUSES)[number]) => void;
  selectedWorkItemId: string | null;
  onSelectedWorkItemIdChange: (id: string | null) => void;
  workboardError: string | null;
  workboardErrorDismissed: boolean;
  onDismissWorkboardError: () => void;
  selectedItem: WorkItem | null;
  drilldownBusy: boolean;
  drilldownError: string | null;
  pendingAction: WorkItem["status"] | "pause" | "resume" | "delete" | null;
  canMarkReadySelected: boolean;
  canPauseSelected: boolean;
  canResumeSelected: boolean;
  canEditSelected: boolean;
  canDeleteSelected: boolean;
  canCancelSelected: boolean;
  isReadOnlyLocked: boolean;
  onTransition: (status: WorkItem["status"], reason: string) => Promise<void>;
  onPause: (reason: string) => Promise<void>;
  onResume: (reason: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onEdit: () => void;
  taskCounts: {
    leased: number;
    running: number;
    paused: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  taskList: WorkTaskSummary[];
  approvalBlockers: WorkTaskSummary[];
  decisions: DecisionRecord[];
  artifacts: WorkArtifact[];
  signals: WorkSignal[];
  agentKvEntries: WorkStateKvEntry[];
  workItemKvEntries: WorkStateKvEntry[];
  onNavigate: (id: string) => void;
}) {
  return (
    <>
      {props.desktopBoard ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div data-layout-content="" className="grid gap-4 px-4 py-4 md:px-5 md:py-5">
              <WorkboardErrorBanner
                error={props.workboardError}
                dismissed={props.workboardErrorDismissed}
                onDismiss={props.onDismissWorkboardError}
              />

              <div
                data-testid="workboard-board"
                className="overflow-hidden rounded-lg border border-border bg-bg-card"
              >
                <div
                  data-testid="workboard-board-header"
                  className="grid border-b border-border bg-bg-subtle"
                  style={{ ...DESKTOP_BOARD_GRID_STYLE, ...DESKTOP_BOARD_MIN_WIDTH_STYLE }}
                >
                  {WORK_ITEM_STATUSES.map((status) => (
                    <div
                      key={status}
                      className="border-r border-border px-2.5 py-2.5 last:border-r-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-fg">
                          {STATUS_LABELS[status]}
                        </span>
                        <span className="text-xs text-fg-muted">
                          {props.grouped[status].length}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  className="grid"
                  style={{ ...DESKTOP_BOARD_GRID_STYLE, ...DESKTOP_BOARD_MIN_WIDTH_STYLE }}
                >
                  {WORK_ITEM_STATUSES.map((status) => (
                    <div
                      key={status}
                      data-testid={`workboard-column-${status}`}
                      className="min-h-80 border-r border-border p-2.5 align-top last:border-r-0"
                    >
                      <WorkStatusList
                        items={props.grouped[status]}
                        selectedWorkItemId={props.selectedWorkItemId}
                        onSelect={props.onSelectedWorkItemIdChange}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <WorkboardDrilldownPanel {...props} />
            </div>
          </ScrollArea>
        </div>
      ) : null}
      {!props.desktopBoard ? <MobileWorkboardTabs {...props} /> : null}
    </>
  );
}

function MobileWorkboardTabs(props: Parameters<typeof WorkboardPageLayout>[0]) {
  const tablistRef = useRef<HTMLDivElement>(null);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const currentIndex = WORK_ITEM_STATUSES.indexOf(props.selectedStatus);
      let nextIndex: number;

      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
          nextIndex = (currentIndex + 1) % WORK_ITEM_STATUSES.length;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          nextIndex = (currentIndex - 1 + WORK_ITEM_STATUSES.length) % WORK_ITEM_STATUSES.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = WORK_ITEM_STATUSES.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      const nextStatus = WORK_ITEM_STATUSES[nextIndex];
      if (!nextStatus) return;
      props.onSelectedStatusChange(nextStatus);

      const nextTab = tablistRef.current?.querySelector<HTMLButtonElement>(`#${tabId(nextStatus)}`);
      nextTab?.focus();
    },
    [props.selectedStatus, props.onSelectedStatusChange],
  );

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <ScrollArea className="h-full">
        <div data-layout-content="" className="grid gap-4 px-4 py-4 md:px-5 md:py-5">
          <WorkboardErrorBanner
            error={props.workboardError}
            dismissed={props.workboardErrorDismissed}
            onDismiss={props.onDismissWorkboardError}
          />

          <div className="grid gap-3">
            <div
              ref={tablistRef}
              className="grid gap-2 sm:grid-cols-2"
              data-testid="workboard-status-selector"
              role="tablist"
              aria-label="Work statuses"
            >
              {WORK_ITEM_STATUSES.map((status) => {
                const active = status === props.selectedStatus;
                return (
                  <button
                    key={status}
                    id={tabId(status)}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls={panelId(status)}
                    tabIndex={active ? 0 : -1}
                    data-testid={`workboard-status-${status}`}
                    className={[
                      "flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-0",
                      active
                        ? "border-primary bg-bg text-fg"
                        : "border-border bg-bg hover:bg-bg-subtle",
                    ].join(" ")}
                    onClick={() => {
                      props.onSelectedStatusChange(status);
                    }}
                    onKeyDown={handleTabKeyDown}
                  >
                    <span>{STATUS_LABELS[status]}</span>
                    <span className="text-xs text-fg-muted">{props.grouped[status].length}</span>
                  </button>
                );
              })}
            </div>

            <WorkStatusPanel
              id={panelId(props.selectedStatus)}
              role="tabpanel"
              aria-labelledby={tabId(props.selectedStatus)}
              status={props.selectedStatus}
              items={props.grouped[props.selectedStatus]}
              selectedWorkItemId={props.selectedWorkItemId}
              onSelect={props.onSelectedWorkItemIdChange}
            />
          </div>

          <WorkBoardDrilldown
            selectedWorkItemId={props.selectedWorkItemId}
            drilldownBusy={props.drilldownBusy}
            drilldownError={props.drilldownError}
            selectedItem={props.selectedItem}
            pendingAction={props.pendingAction}
            canMarkReadySelected={props.canMarkReadySelected}
            canPauseSelected={props.canPauseSelected}
            canResumeSelected={props.canResumeSelected}
            canEditSelected={props.canEditSelected}
            canDeleteSelected={props.canDeleteSelected}
            canCancelSelected={props.canCancelSelected}
            isReadOnlyLocked={props.isReadOnlyLocked}
            onTransition={props.onTransition}
            onPause={props.onPause}
            onResume={props.onResume}
            onDelete={props.onDelete}
            onEdit={props.onEdit}
            taskCounts={props.taskCounts}
            taskList={props.taskList}
            approvalBlockers={props.approvalBlockers}
            decisions={props.decisions}
            artifacts={props.artifacts}
            signals={props.signals}
            agentKvEntries={props.agentKvEntries}
            workItemKvEntries={props.workItemKvEntries}
            onNavigate={props.onNavigate}
          />
        </div>
      </ScrollArea>
    </div>
  );
}

function WorkboardErrorBanner(props: {
  error: string | null;
  dismissed: boolean;
  onDismiss: () => void;
}) {
  if (!props.error || props.dismissed) {
    return null;
  }

  return (
    <Alert
      variant="error"
      title="WorkBoard error"
      description={props.error}
      onDismiss={props.onDismiss}
    />
  );
}

function WorkboardDrilldownPanel(props: Parameters<typeof WorkboardPageLayout>[0]) {
  return (
    <div className="rounded-lg border border-border bg-bg-subtle/20">
      <div className="flex h-12 items-center border-b border-border px-4">
        <div className="text-sm font-medium text-fg">
          {props.selectedItem ? "Work item details" : "Select a work item"}
        </div>
      </div>
      <div className="p-4">
        <WorkBoardDrilldown
          selectedWorkItemId={props.selectedWorkItemId}
          drilldownBusy={props.drilldownBusy}
          drilldownError={props.drilldownError}
          selectedItem={props.selectedItem}
          pendingAction={props.pendingAction}
          canMarkReadySelected={props.canMarkReadySelected}
          canPauseSelected={props.canPauseSelected}
          canResumeSelected={props.canResumeSelected}
          canEditSelected={props.canEditSelected}
          canDeleteSelected={props.canDeleteSelected}
          canCancelSelected={props.canCancelSelected}
          isReadOnlyLocked={props.isReadOnlyLocked}
          onTransition={props.onTransition}
          onPause={props.onPause}
          onResume={props.onResume}
          onDelete={props.onDelete}
          onEdit={props.onEdit}
          taskCounts={props.taskCounts}
          taskList={props.taskList}
          approvalBlockers={props.approvalBlockers}
          decisions={props.decisions}
          artifacts={props.artifacts}
          signals={props.signals}
          agentKvEntries={props.agentKvEntries}
          workItemKvEntries={props.workItemKvEntries}
          onNavigate={props.onNavigate}
        />
      </div>
    </div>
  );
}
