import { useState } from "react";
import type { TaskResult } from "@tyrum/client";
import { toast } from "sonner";
import { useBrowserNode } from "../../../browser-node/browser-node-provider.js";
import { Alert } from "../../ui/alert.js";
import { Button } from "../../ui/button.js";
import { Card, CardContent } from "../../ui/card.js";
import { JsonViewer } from "../../ui/json-viewer.js";
import { Switch } from "../../ui/switch.js";

export function BrowserCapabilitiesPage() {
  const browserNode = useBrowserNode();
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
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">Browser Capabilities</h1>

      {!globalThis.isSecureContext ? (
        <Alert
          variant="warning"
          title="Secure context required"
          description="Camera, microphone, and geolocation typically require HTTPS (or localhost)."
        />
      ) : null}

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="flex items-center justify-between gap-3">
            <div className="grid gap-1">
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
            Status <span className="font-medium text-fg">{browserNode.status}</span>
          </div>

          {browserNode.deviceId ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-fg-muted">
                Node ID <code className="font-mono text-xs">{browserNode.deviceId}</code>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const clipboard = globalThis.navigator?.clipboard;
                  if (!clipboard?.writeText) {
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
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-4 pt-6">
          <div className="text-sm font-semibold text-fg">Test actions</div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              isLoading={testBusy}
              disabled={!browserNode.enabled || testBusy}
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
              disabled={!browserNode.enabled || testBusy}
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
              disabled={!browserNode.enabled || testBusy}
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
    </div>
  );
}
