import type { ArtifactRef } from "@tyrum/contracts";
import type { OperatorCore } from "@tyrum/operator-app";
import { useEffect, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { Badge } from "../ui/badge.js";
import { Spinner } from "../ui/spinner.js";
import { StructuredValue } from "../ui/structured-value.js";
import { toArrayBufferBytes } from "../../utils/blob-bytes.js";
import { buildGatewayArtifactUrl } from "../../utils/gateway-artifact-url.js";
import { isRecord } from "../../utils/is-record.js";
import { normalizeHttpUrl } from "../../utils/normalize-http-url.js";

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

function extensionForContentType(contentType: string | undefined): string {
  switch ((contentType ?? "").toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "application/json":
      return ".json";
    case "text/plain":
      return ".txt";
    case "audio/webm":
      return ".webm";
    default:
      return "";
  }
}

function defaultArtifactDownloadName(
  artifact: ArtifactRef,
  contentType: string | undefined,
): string {
  const metadata = artifact.metadata;
  if (isRecord(metadata) && typeof metadata["filename"] === "string") {
    const filename = metadata["filename"].trim();
    if (filename.length > 0) return filename;
  }

  return `${artifact.artifact_id}${extensionForContentType(contentType)}`;
}

function ArtifactDownloadLink({
  artifact,
  downloadUrl,
  contentType,
}: {
  artifact: ArtifactRef;
  downloadUrl: string;
  contentType?: string;
}) {
  return (
    <a
      data-testid={`artifact-download-${artifact.artifact_id}`}
      className="inline-flex items-center gap-1 underline underline-offset-2"
      href={downloadUrl}
      download={defaultArtifactDownloadName(artifact, contentType)}
      target="_blank"
      rel="noreferrer noopener"
    >
      <Download className="h-3 w-3" />
      Download
    </a>
  );
}

function useArtifactInlinePreviewState({
  core,
  artifact,
}: {
  core: OperatorCore;
  artifact: ArtifactRef;
}): {
  artifactsApi: OperatorCore["admin"]["artifacts"] | undefined;
  metadata: ArtifactMetadataState;
  bytes: ArtifactBytesState;
  blobUrl: string | null;
  downloadUrl: string | null;
} {
  const artifactsApi = core.admin.artifacts;
  const [metadata, setMetadata] = useState<ArtifactMetadataState>({ status: "idle" });
  const [bytes, setBytes] = useState<ArtifactBytesState>({ status: "idle" });
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!artifactsApi) return;
    const controller = new AbortController();

    setMetadata({ status: "loading" });
    setBytes({ status: "loading" });

    void artifactsApi
      .getMetadata(artifact.artifact_id, { signal: controller.signal })
      .then((res) => {
        setMetadata({ status: "ready", sensitivity: res.sensitivity });
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setMetadata({ status: "error", message });
      });

    void artifactsApi
      .getBytes(artifact.artifact_id, { signal: controller.signal })
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
  }, [artifactsApi, artifact.artifact_id]);

  useEffect(() => {
    if (bytes.status !== "bytes") return;
    const contentType = bytes.contentType ?? artifact.mime_type ?? "application/octet-stream";
    const blobBytes = toArrayBufferBytes(bytes.bytes);
    const url = URL.createObjectURL(new Blob([blobBytes], { type: contentType }));
    setDownloadUrl(url);
    setBlobUrl(contentType.startsWith("image/") ? url : null);

    return () => {
      URL.revokeObjectURL(url);
      setDownloadUrl((prev) => (prev === url ? null : prev));
      setBlobUrl((prev) => (prev === url ? null : prev));
    };
  }, [artifact.mime_type, bytes]);

  return { artifactsApi, metadata, bytes, blobUrl, downloadUrl };
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
  artifactId,
  artifact,
  url,
}: {
  badge: ReactNode;
  core: OperatorCore;
  artifactId: string;
  artifact: ArtifactRef;
  url: string;
}) {
  const safeUrl = normalizeHttpUrl(url, core.httpBaseUrl);
  const href = safeUrl ?? buildGatewayArtifactUrl(core.httpBaseUrl, artifactId);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      {badge}
      <a className="underline" href={href} target="_blank" rel="noreferrer noopener">
        Open artifact
      </a>
      <ArtifactDownloadLink
        artifact={artifact}
        downloadUrl={href}
        contentType={artifact.mime_type}
      />
    </div>
  );
}

function ArtifactInlinePreviewImage({
  badge,
  artifact,
  blobUrl,
  downloadUrl,
}: {
  badge: ReactNode;
  artifact: ArtifactRef;
  blobUrl: string | null;
  downloadUrl: string | null;
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
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        {badge}
        {downloadUrl ? (
          <ArtifactDownloadLink
            artifact={artifact}
            downloadUrl={downloadUrl}
            contentType={artifact.mime_type}
          />
        ) : null}
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

function ArtifactInlinePreviewJson({
  badge,
  artifact,
  bytes,
  downloadUrl,
}: {
  badge: ReactNode;
  artifact: ArtifactRef;
  bytes: Uint8Array;
  downloadUrl: string | null;
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
    <div className="grid gap-2" data-testid={`artifact-preview-json-${artifact.artifact_id}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        {badge}
        {downloadUrl ? (
          <ArtifactDownloadLink
            artifact={artifact}
            downloadUrl={downloadUrl}
            contentType={artifact.mime_type}
          />
        ) : null}
      </div>
      {parsed === null ? (
        <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-bg-card/40 px-3 py-2 text-xs text-fg">
          {text}
        </pre>
      ) : (
        <div className="max-h-[420px] overflow-auto rounded-md border border-border bg-bg-card/40 px-3 py-2">
          <StructuredValue value={parsed} />
        </div>
      )}
    </div>
  );
}

function ArtifactInlinePreviewUnsupported({
  badge,
  contentType,
  kind,
  artifact,
  downloadUrl,
}: {
  badge: ReactNode;
  contentType: string;
  kind: string;
  artifact: ArtifactRef;
  downloadUrl: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
      {badge}
      <span>Unsupported preview ({contentType || kind}).</span>
      {downloadUrl ? (
        <ArtifactDownloadLink
          artifact={artifact}
          downloadUrl={downloadUrl}
          contentType={contentType}
        />
      ) : null}
    </div>
  );
}

function ArtifactInlinePreviewBytes({
  badge,
  artifact,
  contentType,
  bytes,
  blobUrl,
  downloadUrl,
}: {
  badge: ReactNode;
  artifact: ArtifactRef;
  contentType: string;
  bytes: Uint8Array;
  blobUrl: string | null;
  downloadUrl: string | null;
}) {
  if (contentType.startsWith("image/")) {
    return (
      <ArtifactInlinePreviewImage
        badge={badge}
        artifact={artifact}
        blobUrl={blobUrl}
        downloadUrl={downloadUrl}
      />
    );
  }

  if (contentType.includes("json")) {
    return (
      <ArtifactInlinePreviewJson
        badge={badge}
        artifact={artifact}
        bytes={bytes}
        downloadUrl={downloadUrl}
      />
    );
  }

  return (
    <ArtifactInlinePreviewUnsupported
      badge={badge}
      contentType={contentType}
      kind={artifact.kind}
      artifact={artifact}
      downloadUrl={downloadUrl}
    />
  );
}

export function ArtifactInlinePreview({
  core,
  artifact,
}: {
  core: OperatorCore;
  artifact: ArtifactRef;
}) {
  const { artifactsApi, metadata, bytes, blobUrl, downloadUrl } = useArtifactInlinePreviewState({
    core,
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
        artifactId={artifact.artifact_id}
        artifact={artifact}
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
      downloadUrl={downloadUrl}
    />
  );
}
