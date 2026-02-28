import type { ExecutionAttempt } from "@tyrum/client";
import type { OperatorCore } from "@tyrum/operator-core";
import { useEffect, useState } from "react";
import { isRecord } from "../../utils/is-record.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog.js";
import { Spinner } from "../ui/spinner.js";

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

function normalizeHttpUrl(rawUrl: string, baseUrl?: string): string | undefined {
  const trimmed = rawUrl.trim();
  if (!trimmed) return undefined;
  try {
    const url = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function buildArtifactGatewayUrl(core: OperatorCore, runId: string, artifactId: string): string {
  const base = core.httpBaseUrl.replace(/\/$/, "");
  return `${base}/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`;
}

function JsonTreeNode({
  name,
  value,
  level,
}: {
  name: string;
  value: unknown;
  level: number;
}) {
  if (Array.isArray(value)) {
    const preview = `${name}: [${String(value.length)}]`;
    return (
      <details className="ml-3" open={level < 2}>
        <summary className="cursor-pointer select-none text-xs text-fg">{preview}</summary>
        <div className="mt-1 grid gap-1">
          {value.map((entry, index) => (
            <JsonTreeNode key={index} name={String(index)} value={entry} level={level + 1} />
          ))}
        </div>
      </details>
    );
  }

  if (isRecord(value)) {
    const keys = Object.keys(value);
    const preview = `${name}: {${String(keys.length)}}`;
    return (
      <details className="ml-3" open={level < 2}>
        <summary className="cursor-pointer select-none text-xs text-fg">{preview}</summary>
        <div className="mt-1 grid gap-1">
          {keys.map((key) => (
            <JsonTreeNode key={key} name={key} value={value[key]} level={level + 1} />
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className="ml-3 flex flex-wrap items-center gap-2 text-xs text-fg">
      <span className="text-fg-muted">{name}</span>
      <span className="font-mono">{String(value)}</span>
    </div>
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

    const blobBytes =
      bytes.bytes.buffer instanceof ArrayBuffer
        ? (bytes.bytes as Uint8Array<ArrayBuffer>)
        : new Uint8Array(bytes.bytes);

    const url = URL.createObjectURL(new Blob([blobBytes], { type: contentType }));
    setBlobUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setBlobUrl((prev) => (prev === url ? null : prev));
    };
  }, [artifact.mime_type, bytes]);

  const sensitivityBadge = (() => {
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
  })();

  if (!artifactsApi) {
    return <div className="text-xs text-fg-muted">Artifacts API unavailable.</div>;
  }

  if (bytes.status === "loading" || bytes.status === "idle") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted" aria-busy={true}>
        {sensitivityBadge}
        <Spinner aria-hidden={true} />
        Loading preview...
      </div>
    );
  }

  if (bytes.status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {sensitivityBadge}
        <span className="text-error">Preview failed: {bytes.message}</span>
      </div>
    );
  }

  if (bytes.status === "redirect") {
    const safeUrl = normalizeHttpUrl(bytes.url, core.httpBaseUrl);
    const href = safeUrl ?? buildArtifactGatewayUrl(core, runId, artifact.artifact_id);

    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        {sensitivityBadge}
        <a className="underline" href={href} target="_blank" rel="noreferrer noopener">
          Open artifact
        </a>
      </div>
    );
  }

  const contentType = bytes.contentType ?? artifact.mime_type ?? "";

  if (contentType.startsWith("image/")) {
    if (!blobUrl) {
      return (
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted" aria-busy={true}>
          {sensitivityBadge}
          <Spinner aria-hidden={true} />
          Rendering preview...
        </div>
      );
    }

    return (
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          {sensitivityBadge}
        </div>
        <img
          data-testid={`artifact-preview-image-${artifact.artifact_id}`}
          src={blobUrl}
          alt="Artifact preview"
          className="max-h-[420px] w-full rounded-md border border-border object-contain"
        />
      </div>
    );
  }

  if (contentType.includes("json")) {
    let text = "";
    try {
      text = new TextDecoder().decode(bytes.bytes);
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
      <div className="grid gap-2" data-testid={`artifact-preview-json-${artifact.artifact_id}`}>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
          {sensitivityBadge}
        </div>
        {parsed === null ? (
          <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-bg px-3 py-2 text-xs text-fg">
            {text}
          </pre>
        ) : (
          <div className="max-h-[420px] overflow-auto rounded-md border border-border bg-bg px-3 py-2">
            <JsonTreeNode name="root" value={parsed} level={0} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      {sensitivityBadge}
      <span>Unsupported preview ({contentType || artifact.kind}).</span>
    </div>
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
              <div key={artifact.artifact_id} className="grid gap-2 rounded-md border border-border p-3">
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
