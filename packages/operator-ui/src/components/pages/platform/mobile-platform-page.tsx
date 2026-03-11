import { useEffect, useState } from "react";
import { AppPage } from "../../layout/app-page.js";
import { Alert } from "../../ui/alert.js";
import { Card, CardContent } from "../../ui/card.js";
import { Switch } from "../../ui/switch.js";
import {
  useHostApi,
  type MobileHostActionName,
  type MobileHostState,
} from "../../../host/host-api.js";
import { formatErrorMessage } from "../../../utils/format-error-message.js";

const ACTION_COPY: ReadonlyArray<{
  action: MobileHostActionName;
  label: string;
  description: string;
}> = [
  {
    action: "location.get_current",
    label: "Location",
    description: "Expose current device location to the local mobile node.",
  },
  {
    action: "camera.capture_photo",
    label: "Camera",
    description: "Expose still-photo capture from the device camera.",
  },
  {
    action: "audio.record_clip",
    label: "Audio",
    description: "Expose short microphone recordings from the device.",
  },
];

function formatPlatform(platform: MobileHostState["platform"]): string {
  return platform === "ios" ? "iOS" : "Android";
}

export function MobilePlatformPage() {
  const host = useHostApi();
  const [state, setState] = useState<MobileHostState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (host.kind !== "mobile") return;
    let active = true;

    void host.api.node
      .getState()
      .then((nextState) => {
        if (!active) return;
        setState(nextState);
        setErrorMessage(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setErrorMessage(formatErrorMessage(error));
      });

    const unsubscribe = host.api.onStateChange?.((nextState) => {
      if (!active) return;
      setState(nextState);
      setErrorMessage(null);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [host]);

  if (host.kind !== "mobile") {
    return (
      <AppPage contentClassName="max-w-5xl gap-4">
        <Alert
          variant="warning"
          title="Not available"
          description="Mobile platform controls are only available in the mobile app."
        />
      </AppPage>
    );
  }

  const applyStateChange = async (
    nextBusyKey: string,
    update: () => Promise<MobileHostState>,
  ): Promise<void> => {
    if (busyKey) return;
    setBusyKey(nextBusyKey);
    try {
      const nextState = await update();
      setState(nextState);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(formatErrorMessage(error));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <AppPage contentClassName="max-w-5xl gap-4" data-testid="mobile-platform-page">
      {!state ? (
        <Card>
          <CardContent className="grid gap-2 pt-6 text-sm text-fg-muted">
            <div>Loading mobile node settings…</div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="grid gap-4 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 grid gap-1">
                  <div className="text-sm font-semibold text-fg">Mobile node executor</div>
                  <div className="text-sm text-fg-muted">
                    Manage the local {formatPlatform(state.platform)} node exposed by the mobile
                    host app.
                  </div>
                </div>
                <Switch
                  aria-label="Enable mobile node executor"
                  checked={state.enabled}
                  disabled={busyKey !== null}
                  onCheckedChange={(checked) => {
                    void applyStateChange("enabled", () => host.api.node.setEnabled(checked));
                  }}
                />
              </div>

              <div className="grid gap-1 text-sm text-fg-muted">
                <div>
                  Platform{" "}
                  <span className="font-medium text-fg">{formatPlatform(state.platform)}</span>
                </div>
                <div>
                  Status <span className="font-medium text-fg">{state.status}</span>
                </div>
                {state.deviceId ? (
                  <div>
                    Node ID <code className="break-all font-mono text-xs">{state.deviceId}</code>
                  </div>
                ) : null}
              </div>

              {state.error ? (
                <Alert variant="error" title="Mobile node error" description={state.error} />
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-3 pt-6">
              <div className="text-sm font-semibold text-fg">Action controls</div>
              {ACTION_COPY.map((entry) => {
                const actionState = state.actions[entry.action];
                return (
                  <div
                    key={entry.action}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border/60 bg-panel px-3 py-3"
                  >
                    <div className="min-w-0 grid gap-1">
                      <div className="text-sm font-medium text-fg">{entry.label}</div>
                      <div className="text-sm text-fg-muted">{entry.description}</div>
                      <div className="text-xs text-fg-muted">
                        Status{" "}
                        <span className="font-medium text-fg">
                          {actionState.enabled ? "enabled" : "disabled"}
                        </span>
                        {" · "}
                        <span className="font-medium text-fg">
                          {actionState.availabilityStatus}
                        </span>
                      </div>
                      {actionState.unavailableReason ? (
                        <div className="text-xs text-danger">{actionState.unavailableReason}</div>
                      ) : null}
                    </div>
                    <Switch
                      aria-label={`Enable ${entry.label.toLowerCase()} capability`}
                      checked={actionState.enabled}
                      disabled={!state.enabled || busyKey !== null}
                      onCheckedChange={(checked) => {
                        void applyStateChange(entry.action, () =>
                          host.api.node.setActionEnabled(entry.action, checked),
                        );
                      }}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </>
      )}

      {errorMessage ? (
        <Alert variant="error" title="Failed to update mobile node" description={errorMessage} />
      ) : null}
    </AppPage>
  );
}
