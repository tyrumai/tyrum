import type { OperatorCore } from "@tyrum/operator-core";
import { useEffect, useMemo, useState } from "react";
import type { Components } from "react-markdown";
import { Download } from "lucide-react";
import { toArrayBufferBytes } from "../../utils/blob-bytes.js";
import { buildGatewayArtifactUrl } from "../../utils/gateway-artifact-url.js";
import { Spinner } from "../ui/spinner.js";

const ARTIFACT_URI_PATTERN =
  /^artifact:\/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function parseArtifactUri(uri: string): string | null {
  const match = uri.match(ARTIFACT_URI_PATTERN);
  return match?.[1] ?? null;
}

function ArtifactMarkdownImage({
  artifactId,
  alt,
  core,
}: {
  artifactId: string;
  alt: string;
  core: OperatorCore;
}) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);

    const artifactsApi = core.http.artifacts;
    if (!artifactsApi) {
      setError("Artifacts API unavailable");
      return;
    }

    const controller = new AbortController();
    void artifactsApi
      .getBytes(artifactId, { signal: controller.signal })
      .then((res) => {
        if (res.kind === "redirect") {
          setBlobUrl(res.url);
          return;
        }
        const bytes = toArrayBufferBytes(res.bytes);
        const contentType = res.contentType ?? "image/jpeg";
        const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
        setBlobUrl(url);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      controller.abort();
      setBlobUrl((prev) => {
        if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [artifactId, core]);

  if (error) {
    return <span className="text-xs text-danger-700">Image failed: {error}</span>;
  }

  if (!blobUrl) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
        <Spinner aria-hidden={true} /> Loading image…
      </span>
    );
  }

  const downloadUrl = buildGatewayArtifactUrl(core.httpBaseUrl, artifactId);
  return (
    <span className="block">
      <img
        src={blobUrl}
        alt={alt || "Artifact image"}
        className="max-h-[420px] w-full rounded-md border border-border object-contain"
      />
      <a
        href={downloadUrl}
        target="_blank"
        rel="noreferrer noopener"
        download
        className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
      >
        <Download className="h-3 w-3" />
        Download
      </a>
    </span>
  );
}

export function useArtifactAwareMarkdownComponents(
  core: OperatorCore | undefined,
): Components | undefined {
  return useMemo(() => {
    if (!core) return undefined;

    return {
      a({ href, children, ...rest }) {
        if (href) {
          const artifactId = parseArtifactUri(href);
          if (artifactId) {
            const downloadUrl = buildGatewayArtifactUrl(core.httpBaseUrl, artifactId);
            return (
              <a {...rest} href={downloadUrl} target="_blank" rel="noreferrer noopener" download>
                {children} <Download className="ml-0.5 inline h-3 w-3" />
              </a>
            );
          }
        }
        return (
          <a {...rest} href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        );
      },
      img({ src, alt, ...rest }) {
        if (src) {
          const artifactId = parseArtifactUri(src);
          if (artifactId) {
            return <ArtifactMarkdownImage artifactId={artifactId} alt={alt ?? ""} core={core} />;
          }
        }
        return <img {...rest} src={src} alt={alt} />;
      },
    } satisfies Components;
  }, [core]);
}
