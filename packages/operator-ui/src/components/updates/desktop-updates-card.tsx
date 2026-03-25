import { useEffect, useState } from "react";
import { useTranslateNode } from "../../i18n-helpers.js";
import type { DesktopApi } from "../../desktop-api.js";
import { formatErrorMessage } from "../../utils/format-error-message.js";
import { Alert } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Card, CardContent } from "../ui/card.js";

interface DesktopUpdateState {
  stage:
    | "idle"
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "installing"
    | "error";
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  progressPercent: number | null;
  message: string | null;
  checkedAt: string | null;
}

interface ManualReleaseFileResult {
  opened: boolean;
  path: string | null;
  message: string | null;
}

const UPDATE_STAGE_LABEL: Record<DesktopUpdateState["stage"], string> = {
  idle: "Idle",
  checking: "Checking for updates...",
  available: "Update available",
  "not-available": "Up to date",
  downloading: "Downloading update...",
  downloaded: "Ready to install",
  installing: "Installing update...",
  error: "Update error",
};

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  const translateNode = useTranslateNode();
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-b-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {translateNode(label)}
      </span>
      <span className="text-sm font-semibold text-fg">{translateNode(value)}</span>
    </div>
  );
}

export interface DesktopUpdatesCardProps {
  api: DesktopApi;
  title?: string;
  testId?: string;
  id?: string;
}

export function DesktopUpdatesCard({
  api,
  title = "Desktop Updates",
  testId,
  id,
}: DesktopUpdatesCardProps) {
  const translateNode = useTranslateNode();
  const [updateState, setUpdateState] = useState<DesktopUpdateState>({
    stage: "idle",
    currentVersion: "unknown",
    availableVersion: null,
    downloadedVersion: null,
    releaseDate: null,
    releaseNotes: null,
    progressPercent: null,
    message: null,
    checkedAt: null,
  });
  const [updateBusy, setUpdateBusy] = useState<"check" | "download" | "install" | "manual" | null>(
    null,
  );
  const [updateActionNote, setUpdateActionNote] = useState<string | null>(null);

  const checkForUpdates = async () => {
    if (!api.updates || updateBusy !== null) return;

    setUpdateActionNote(null);
    setUpdateBusy("check");
    try {
      const next = (await api.updates.check()) as DesktopUpdateState;
      setUpdateState(next);
      setUpdateActionNote("Update check started.");
    } catch (error: unknown) {
      setUpdateActionNote(formatErrorMessage(error));
    } finally {
      setUpdateBusy(null);
    }
  };

  const downloadUpdate = async () => {
    if (!api.updates || updateBusy !== null) return;

    setUpdateActionNote(null);
    setUpdateBusy("download");
    try {
      const next = (await api.updates.download()) as DesktopUpdateState;
      setUpdateState(next);
      setUpdateActionNote("Download started.");
    } catch (error: unknown) {
      setUpdateActionNote(formatErrorMessage(error));
    } finally {
      setUpdateBusy(null);
    }
  };

  const installUpdate = async () => {
    if (!api.updates || updateBusy !== null) return;

    setUpdateActionNote(null);
    setUpdateBusy("install");
    try {
      const next = (await api.updates.install()) as DesktopUpdateState;
      setUpdateState(next);
      setUpdateActionNote("Installing update...");
    } catch (error: unknown) {
      setUpdateActionNote(formatErrorMessage(error));
    } finally {
      setUpdateBusy(null);
    }
  };

  const openManualReleaseFile = async () => {
    if (!api.updates || updateBusy !== null) return;

    setUpdateActionNote(null);
    setUpdateBusy("manual");
    try {
      const result = (await api.updates.openReleaseFile()) as ManualReleaseFileResult;
      if (result.message) {
        setUpdateActionNote(result.message);
      } else if (result.opened) {
        setUpdateActionNote("Installer opened.");
      }
    } catch (error: unknown) {
      setUpdateActionNote(formatErrorMessage(error));
    } finally {
      setUpdateBusy(null);
    }
  };

  useEffect(() => {
    if (!api.updates) return;
    let disposed = false;

    void api.updates
      .getState()
      .then((snapshot) => {
        if (disposed) return;
        setUpdateState(snapshot as DesktopUpdateState);
      })
      .catch(() => {
        // Ignore snapshot failures; event updates can still refresh the state.
      });

    if (!api.onUpdateStateChange) {
      return () => {
        disposed = true;
      };
    }

    const unsubscribe = api.onUpdateStateChange((state) => {
      if (disposed) return;
      setUpdateState(state as DesktopUpdateState);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [api]);

  return (
    <Card data-testid={testId} id={id}>
      <CardContent className="grid gap-4 pt-6">
        <div className="text-sm font-semibold text-fg">{translateNode(title)}</div>
        {!api.updates ? (
          <Alert
            variant="info"
            title="Updates unavailable"
            description="This desktop build does not expose update controls."
          />
        ) : (
          <>
            <div className="text-sm text-fg-muted">
              {translateNode(
                "Update checks run automatically at startup. Download and install require explicit user actions.",
              )}
            </div>

            <div className="grid gap-0">
              <DetailRow label="Current version" value={updateState.currentVersion} />
              <DetailRow
                label="Status"
                value={UPDATE_STAGE_LABEL[updateState.stage] ?? updateState.stage}
              />
              {updateState.availableVersion ? (
                <DetailRow label="Available version" value={updateState.availableVersion} />
              ) : null}
              {updateState.progressPercent != null ? (
                <DetailRow
                  label="Download progress"
                  value={`${Math.round(updateState.progressPercent)}%`}
                />
              ) : null}
            </div>

            {updateState.message ? (
              <Alert
                variant={updateState.stage === "error" ? "error" : "info"}
                title={updateState.stage === "error" ? "Update error" : "Update"}
                description={updateState.message}
              />
            ) : null}

            {updateState.releaseNotes ? (
              <div className="rounded-md border border-border bg-bg-subtle p-3 text-sm text-fg-muted">
                <div className="whitespace-pre-wrap">{updateState.releaseNotes}</div>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  void checkForUpdates();
                }}
                isLoading={updateBusy === "check"}
                disabled={updateBusy !== null}
              >
                {updateBusy === "check" ? "Checking..." : "Check for Updates"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void downloadUpdate();
                }}
                isLoading={updateBusy === "download"}
                disabled={updateBusy !== null || updateState.stage !== "available"}
              >
                {updateBusy === "download" ? "Downloading..." : "Download Update"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void installUpdate();
                }}
                isLoading={updateBusy === "install"}
                disabled={updateBusy !== null || updateState.stage !== "downloaded"}
              >
                {updateBusy === "install" ? "Installing..." : "Install Update"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  void openManualReleaseFile();
                }}
                isLoading={updateBusy === "manual"}
                disabled={updateBusy !== null}
              >
                {updateBusy === "manual" ? "Opening..." : "Use Local Release File"}
              </Button>
            </div>

            {updateActionNote ? (
              <Alert variant="info" title="Desktop updates" description={updateActionNote} />
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
