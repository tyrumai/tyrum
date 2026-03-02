import type { ExecutionAttempt } from "@tyrum/client";
import type { OperatorCore } from "@tyrum/operator-core";
import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { JsonViewer } from "../ui/json-viewer.js";
import { Spinner } from "../ui/spinner.js";
import { toArrayBufferBytes } from "../../utils/blob-bytes.js";
import { buildGatewayArtifactUrl } from "../../utils/gateway-artifact-url.js";
import { normalizeHttpUrl } from "../../utils/normalize-http-url.js";

type ArtifactRef = ExecutionAttempt["artifacts"][number];

type ArtifactBytesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "redirect"; url: string }
  | { status: "bytes"; bytes: Uint8Array; contentType?: string };

type ArtifactMetadataState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sensitivity?: string };

function useArtifactInlinePreviewState({
  core,
  runId,
  artifact,
}: {
  core: OperatorCore;
  runId: string;
  artifact: ArtifactRef;
}): {
  artifactsApi: OperatorCore["http"]["artifacts"] | undefined;
  metadata: ArtifactMetadataState;
  bytes: ArtifactBytesState;
  blobUrl: string | null;
} {
  const artifactsApi = core.http.artifacts;
  const [metadata, setMetadata] = useState<ArtifactMetadataState>({ status: "idle" });
  const [bytes, setBytes] = useState<ArtifactBytesState>({ status: "idle" });
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!artifactsApi) return;
    const controller = new AbortController();

    setMetadata({ status: "loading" });
    setBytes({ status: "loading" });

    void artifactsApi
      .getMetadata(runId, artifact.artifact_id, { signal: controller.signal })
      .then((res) => {
        setMetadata({ status: "ready", sensitivity: res.scope.sensitivity });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setMetadata({ status: "error", message });
      });

    void artifactsApi
      .getBytes(runId, artifact.artifact_id, { signal: controller.signal })
      .then((res) => {
        if (res.kind === "redirect") {
          setBytes({ status: "redirect", url: res.url });
          return;
        }
        setBytes({ status: "bytes", bytes: res.bytes, contentType: res.contentType });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setBytes({ status: "error", message });
      });

    return () => {
      controller.abort();
    };
  }, [artifactsApi, artifact.artifact_id, runId]);

  useEffect(() => {
    if (bytes.status !== "bytes") return;
    const contentType = bytes.contentType ?? artifact.mime_type ?? "application/octet-stream";
    if (!contentType.startsWith("image/")) return;

    const blobBytes = toArrayBufferBytes(bytes.bytes);
    const url = URL.createObjectURL(new Blob([blobBytes], { type: contentType }));
    setBlobUrl(url);

    return () => {
      URL.revokeObjectURL(url);
      setBlobUrl((prev) => (prev === url ? null : prev));
    };
  }, [artifact.mime_type, bytes]);

  return { artifactsApi, metadata, bytes, blobUrl };
}

function ArtifactSensitivityBadge({ metadata }: { metadata: ArtifactMetadataState }) {
  if (metadata.status === "ready" && typeof metadata.sensitivity === "string") {
    return metadata.sensitivity.toLowerCase().includes("sensitive") ? (
      <Badge variant="danger">Sensitive</Badge>
    ) : (
      <Badge variant="outline">{metadata.sensitivity}</Badge>
    );
  }

  if (metadata.status === "error") {
    return <Badge variant="outline">Sensitivity unknown</Badge>;
  }

  if (metadata.status === "loading") {
    return <Badge variant="outline">Sensitivity…</Badge>;
  }

  return null;
}

function ArtifactInlinePreviewLoading({ badge }: { badge: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted" aria-busy={true}>
      {badge}
      <Spinner aria-hidden={true} />
      Loading preview...
    </div>
  );
}

function ArtifactInlinePreviewError({ badge, message }: { badge: ReactNode; message: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {badge}
      <span className="text-error">Preview failed: {message}</span>
    </div>
  );
}

function ArtifactInlinePreviewRedirect({
  badge,
  core,
  runId,
  artifactId,
  url,
}: {
  badge: ReactNode;
  core: OperatorCore;
  runId: string;
  artifactId: string;
  url: string;
}) {
  const safeUrl = normalizeHttpUrl(url, core.httpBaseUrl);
  const href = safeUrl ?? buildGatewayArtifactUrl(core.httpBaseUrl, runId, artifactId);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      {badge}
      <a className="underline" href={href} target="_blank" rel="noreferrer noopener">
        Open artifact
      </a>
    </div>
  );
}

function ArtifactInlinePreviewImage({
  badge,
  artifactId,
  blobUrl,
}: {
  badge: ReactNode;
  artifactId: string;
  blobUrl: string | null;
}) {
  if (!blobUrl) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted" aria-busy={true}>
        {badge}
        <Spinner aria-hidden={true} />
        Rendering preview...
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">{badge}</div>
      <img
        data-testid={`artifact-preview-image-${artifactId}`}
        src={blobUrl}
        alt="Artifact preview"
        className="max-h-[420px] w-full rounded-md border border-border object-contain"
      />
    </div>
  );
}

function ArtifactInlinePreviewJson({
  badge,
  artifactId,
  bytes,
}: {
  badge: ReactNode;
  artifactId: string;
  bytes: Uint8Array;
}) {
  let text = "";
  try {
    text = new TextDecoder().decode(bytes);
  } catch {
    text = "";
  }

  let parsed: unknown | null = null;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = null;
  }

  return (
    <div className="grid gap-2" data-testid={`artifact-preview-json-${artifactId}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">{badge}</div>
      {parsed === null ? (
        <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-bg px-3 py-2 text-xs text-fg">
          {text}
        </pre>
      ) : (
        <JsonViewer value={parsed} contentClassName="max-h-[420px]" />
      )}
    </div>
  );
}

function ArtifactInlinePreviewUnsupported({
  badge,
  contentType,
  kind,
}: {
  badge: ReactNode;
  contentType: string;
  kind: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      {badge}
      <span>Unsupported preview ({contentType || kind}).</span>
    </div>
  );
}

function ArtifactInlinePreviewBytes({
  badge,
  artifact,
  contentType,
  bytes,
  blobUrl,
}: {
  badge: ReactNode;
  artifact: ArtifactRef;
  contentType: string;
  bytes: Uint8Array;
  blobUrl: string | null;
}) {
  if (contentType.startsWith("image/")) {
    return (
      <ArtifactInlinePreviewImage
        badge={badge}
        artifactId={artifact.artifact_id}
        blobUrl={blobUrl}
      />
    );
  }

  if (contentType.includes("json")) {
    return (
      <ArtifactInlinePreviewJson badge={badge} artifactId={artifact.artifact_id} bytes={bytes} />
    );
  }

  return (
    <ArtifactInlinePreviewUnsupported
      badge={badge}
      contentType={contentType}
      kind={artifact.kind}
    />
  );
}

function ArtifactInlinePreview({
  core,
  runId,
  artifact,
}: {
  core: OperatorCore;
  runId: string;
  artifact: ArtifactRef;
}) {
  const { artifactsApi, metadata, bytes, blobUrl } = useArtifactInlinePreviewState({
    core,
    runId,
    artifact,
  });
  const badge = <ArtifactSensitivityBadge metadata={metadata} />;

  if (!artifactsApi) {
    return <div className="text-xs text-fg-muted">Artifacts API unavailable.</div>;
  }

  if (bytes.status === "loading" || bytes.status === "idle") {
    return <ArtifactInlinePreviewLoading badge={badge} />;
  }

  if (bytes.status === "error") {
    return <ArtifactInlinePreviewError badge={badge} message={bytes.message} />;
  }

  if (bytes.status === "redirect") {
    return (
      <ArtifactInlinePreviewRedirect
        badge={badge}
        core={core}
        runId={runId}
        artifactId={artifact.artifact_id}
        url={bytes.url}
      />
    );
  }

  return (
    <ArtifactInlinePreviewBytes
      badge={badge}
      artifact={artifact}
      contentType={bytes.contentType ?? artifact.mime_type ?? ""}
      bytes={bytes.bytes}
      blobUrl={blobUrl}
    />
  );
}

export function AttemptArtifactsDialog({
  core,
  runId,
  attemptId,
  artifacts,
}: {
  core: OperatorCore;
  runId: string;
  attemptId: string;
  artifacts: ArtifactRef[];
}) {
  const [open, setOpen] = useState(false);

  if (artifacts.length === 0) return null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        data-testid={`attempt-artifacts-${attemptId}`}
        onClick={() => {
          setOpen(true);
        }}
      >
        Artifacts ({artifacts.length})
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid={`attempt-artifacts-dialog-${attemptId}`} className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Artifacts</DialogTitle>
            <DialogDescription>Desktop evidence captured during this attempt.</DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid gap-4">
            {artifacts.map((artifact) => (
              <div
                key={artifact.artifact_id}
                className="grid gap-2 rounded-md border border-border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{artifact.kind}</Badge>
                    {artifact.labels?.slice(0, 4).map((label) => (
                      <Badge key={label} variant="outline">
                        {label}
                      </Badge>
                    ))}
                  </div>
                  <code className="text-xs text-fg-muted">{artifact.artifact_id}</code>
                </div>
                <ArtifactInlinePreview core={core} runId={runId} artifact={artifact} />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
