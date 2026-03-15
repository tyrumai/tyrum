import { useState } from "react";
import type { TaskResult } from "@tyrum/client";
import { toast } from "sonner";
import { useBrowserNode } from "../../../browser-node/browser-node-provider.js";
import { AppPage } from "../../layout/app-page.js";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { JsonViewer } from "../../ui/json-viewer.js";
import { Switch } from "../../ui/switch.js";
import { useClipboard } from "../../../utils/clipboard.js";

function describeEffectiveCapabilityState(input: {
  executorEnabled: boolean;
  capabilityEnabled: boolean;
  availabilityStatus: string;
}): string {
  if (!input.executorEnabled) {
    return input.capabilityEnabled
      ? "inactive until the browser executor is enabled"
      : "inactive while the browser executor is disabled";
  }
  return input.capabilityEnabled ? input.availabilityStatus : "disabled";
}

export function BrowserCapabilitiesPage() {
  const browserNode = useBrowserNode();
  const clipboard = useClipboard();
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<TaskResult | null>(null);

  const runTest = async (fn: () => Promise<TaskResult>): Promise<void> => {
    if (testBusy) return;
    setTestBusy(true);
    try {
      const result = await fn();
      setTestResult(result);
      if (result.success) {
        toast.success("Browser capability executed");
      } else {
        toast.error(result.error ?? "Browser capability failed");
      }
    } finally {
      setTestBusy(false);
    }
  };

  const summarized = (() => {
    if (!testResult) return null;
    const evidence = testResult.evidence;
    if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
      const rec = { ...(evidence as Record<string, unknown>) };
      const bytesBase64 = rec["bytesBase64"];
      if (typeof bytesBase64 === "string") {
        rec["bytesBase64"] = `[omitted ${String(bytesBase64.length)} chars]`;
        rec["bytes_omitted"] = true;
      }
      return { ...testResult, evidence: rec };
    }
    return testResult;
  })();

  return (
    <AppPage contentClassName="max-w-5xl gap-4">
      {!globalThis.isSecureContext ? (
        <Alert
          variant="warning"
          title="Secure context required"
          description="Camera, microphone, and geolocation typically require HTTPS (or localhost)."
        />
      ) : null}

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 grid gap-1">
              <div className="text-sm font-semibold text-fg">Browser node executor</div>
              <div className="text-sm text-fg-muted">
                Enables workflows to request location, camera, and microphone via a paired browser
                node.
              </div>
            </div>
            <Switch
              aria-label="Enable browser node executor"
              checked={browserNode.enabled}
              onCheckedChange={(checked) => {
                browserNode.setEnabled(checked);
              }}
            />
          </div>

          <div className="text-sm text-fg-muted">
            Executor status <span className="font-medium text-fg">{browserNode.status}</span>
          </div>

          {browserNode.deviceId ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-fg-muted">
                Node ID <code className="break-all font-mono text-xs">{browserNode.deviceId}</code>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!clipboard.canWrite) {
                    toast.error("Clipboard API unavailable");
                    return;
                  }
                  void clipboard
                    .writeText(browserNode.deviceId!)
                    .then(() => toast.success("Copied node id"))
                    .catch(() => toast.error("Failed to copy"));
                }}
              >
                Copy
              </Button>
            </div>
          ) : null}

          {browserNode.error ? (
            <Alert variant="error" title="Browser node error" description={browserNode.error} />
          ) : null}

          <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-4">
            <div className="text-sm font-semibold text-fg">Action controls</div>
            {[
              {
                name: "geolocation.get" as const,
                label: "Location",
                description: "Expose browser geolocation requests to the agent.",
              },
              {
                name: "camera.capture_photo" as const,
                label: "Camera",
                description: "Expose still-photo capture from the browser camera.",
              },
              {
                name: "microphone.record" as const,
                label: "Microphone",
                description: "Expose browser microphone recording.",
              },
            ].map((entry) => {
              const state = browserNode.capabilityStates[entry.name];
              return (
                <div
                  key={entry.name}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border/60 bg-panel px-3 py-3"
                >
                  <div className="min-w-0 grid gap-1">
                    <div className="text-sm font-medium text-fg">{entry.label}</div>
                    <div className="text-sm text-fg-muted">{entry.description}</div>
                    <div className="text-xs text-fg-muted">
                      Configured{" "}
                      <span className="font-medium text-fg">
                        {state.enabled ? "enabled" : "disabled"}
                      </span>
                    </div>
                    <div className="text-xs text-fg-muted">
                      Effective{" "}
                      <span className="font-medium text-fg">{state.availability_status}</span>
                      {" · "}
                      <span className="font-medium text-fg">
                        {describeEffectiveCapabilityState({
                          executorEnabled: browserNode.enabled,
                          capabilityEnabled: state.enabled,
                          availabilityStatus: state.availability_status,
                        })}
                      </span>
                    </div>
                    {state.unavailable_reason ? (
                      <div className="text-xs text-danger">{state.unavailable_reason}</div>
                    ) : null}
                  </div>
                  <Switch
                    aria-label={`Enable ${entry.label.toLowerCase()} capability`}
                    checked={state.enabled}
                    disabled={!browserNode.enabled}
                    onCheckedChange={(checked) => {
                      browserNode.setCapabilityEnabled(entry.name, checked);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="text-sm font-semibold text-fg">Test actions</div>
          {!browserNode.enabled ? (
            <Alert
              variant="info"
              title="Enable the browser executor to run tests"
              description="Capability toggles are saved, but local capability checks stay inactive until the browser node executor is enabled."
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              isLoading={testBusy}
              disabled={
                !browserNode.enabled ||
                !browserNode.capabilityStates["geolocation.get"].enabled ||
                browserNode.capabilityStates["geolocation.get"].availability_status ===
                  "unavailable" ||
                testBusy
              }
              onClick={() => {
                void runTest(() =>
                  browserNode.executeLocal({
                    op: "geolocation.get",
                    enable_high_accuracy: false,
                    timeout_ms: 30_000,
                    maximum_age_ms: 0,
                  }),
                );
              }}
            >
              Get location
            </Button>
            <Button
              variant="outline"
              isLoading={testBusy}
              disabled={
                !browserNode.enabled ||
                !browserNode.capabilityStates["camera.capture_photo"].enabled ||
                browserNode.capabilityStates["camera.capture_photo"].availability_status ===
                  "unavailable" ||
                testBusy
              }
              onClick={() => {
                void runTest(() =>
                  browserNode.executeLocal({
                    op: "camera.capture_photo",
                    format: "jpeg",
                    quality: 0.92,
                  }),
                );
              }}
            >
              Capture photo
            </Button>
            <Button
              variant="outline"
              isLoading={testBusy}
              disabled={
                !browserNode.enabled ||
                !browserNode.capabilityStates["microphone.record"].enabled ||
                browserNode.capabilityStates["microphone.record"].availability_status ===
                  "unavailable" ||
                testBusy
              }
              onClick={() => {
                void runTest(() =>
                  browserNode.executeLocal({ op: "microphone.record", duration_ms: 3_000 }),
                );
              }}
            >
              Record 3s audio
            </Button>
          </div>

          {summarized ? <JsonViewer value={summarized} defaultExpandedDepth={3} /> : null}
        </CardContent>
      </Card>
    </AppPage>
  );
}
