import type { OperatorCore } from "@tyrum/operator-core";
import * as React from "react";
import { ApiResultCard } from "../ui/api-result-card.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { toArrayBufferBytes } from "../../utils/blob-bytes.js";
import { buildGatewayArtifactUrl } from "../../utils/gateway-artifact-url.js";
import { normalizeHttpUrl } from "../../utils/normalize-http-url.js";
import { optionalString, useApiAction } from "./admin-http-shared.js";

const DEFAULT_RESULT_VIEWER_PROPS = {
  defaultExpandedDepth: 1,
  contentClassName: "max-h-[420px]",
} as const;

type ArtifactBytesUiResult =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "redirect"; url: string }
  | { kind: "bytes"; url: string; contentType?: string; byteLength: number };

function toArtifactBytesCardValue(result: ArtifactBytesUiResult): unknown | undefined {
  switch (result.kind) {
    case "bytes":
      return { kind: result.kind, byteLength: result.byteLength, contentType: result.contentType };
    case "redirect":
      return { kind: result.kind, url: result.url };
    case "loading":
      return { kind: result.kind };
    default:
      return undefined;
  }
}

function ArtifactDownloadLink({
  core,
  runId,
  artifactId,
  result,
}: {
  core: OperatorCore;
  runId: string;
  artifactId: string;
  result: ArtifactBytesUiResult;
}) {
  if (result.kind === "redirect") {
    const safeUrl = normalizeHttpUrl(result.url, core.httpBaseUrl);
    const href = safeUrl ?? buildGatewayArtifactUrl(core.httpBaseUrl, runId, artifactId);

    return (
      <a className="underline text-sm" href={href} target="_blank" rel="noreferrer noopener">
        Open artifact
      </a>
    );
  }

  if (result.kind === "bytes") {
    return (
      <a className="underline text-sm" href={result.url} download={`artifact-${artifactId}`}>
        Download bytes
      </a>
    );
  }

  return null;
}

function ArtifactsMetadataTab({
  core,
  runId,
  artifactId,
}: {
  core: OperatorCore;
  runId: string | undefined;
  artifactId: string | undefined;
}) {
  const artifactsApi = core.http.artifacts;
  const action = useApiAction<unknown>();
  const canQuery = Boolean(runId && artifactId);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          isLoading={action.isLoading}
          disabled={!canQuery}
          onClick={() => {
            if (!runId || !artifactId) return;
            void action.run(() => artifactsApi.getMetadata(runId, artifactId));
          }}
        >
          Fetch metadata
        </Button>
        <Button
          variant="secondary"
          disabled={action.isLoading}
          onClick={() => {
            action.reset();
          }}
        >
          Clear
        </Button>
      </div>
      <ApiResultCard
        heading="Metadata"
        value={action.value}
        error={action.error}
        jsonViewerProps={DEFAULT_RESULT_VIEWER_PROPS}
      />
    </>
  );
}

function ArtifactsDownloadTab({
  core,
  runId,
  artifactId,
}: {
  core: OperatorCore;
  runId: string | undefined;
  artifactId: string | undefined;
}) {
  const artifactsApi = core.http.artifacts;
  const [result, setResult] = React.useState<ArtifactBytesUiResult>({ kind: "idle" });

  React.useEffect(() => {
    if (result.kind !== "bytes") return;
    const url = result.url;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [result]);

  const canQuery = Boolean(runId && artifactId);

  const value = toArtifactBytesCardValue(result);
  const error = result.kind === "error" ? result.error : undefined;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-testid="admin-http-artifacts-download"
          isLoading={result.kind === "loading"}
          disabled={!canQuery || result.kind === "loading"}
          onClick={() => {
            if (!runId || !artifactId) return;
            setResult({ kind: "loading" });
            void artifactsApi
              .getBytes(runId, artifactId)
              .then((res) => {
                if (res.kind === "redirect") {
                  setResult({ kind: "redirect", url: res.url });
                  return;
                }

                const blobBytes = toArrayBufferBytes(res.bytes);
                const url = URL.createObjectURL(new Blob([blobBytes], { type: res.contentType }));
                setResult({
                  kind: "bytes",
                  url,
                  contentType: res.contentType,
                  byteLength: res.bytes.byteLength,
                });
              })
              .catch((err) => {
                setResult({ kind: "error", error: err });
              });
          }}
        >
          Fetch bytes
        </Button>
        <Button
          variant="secondary"
          disabled={result.kind === "loading"}
          onClick={() => {
            setResult({ kind: "idle" });
          }}
        >
          Clear
        </Button>
        {runId && artifactId ? (
          <ArtifactDownloadLink core={core} runId={runId} artifactId={artifactId} result={result} />
        ) : null}
      </div>
      <ApiResultCard
        heading="Bytes result"
        value={value}
        error={error}
        jsonViewerProps={{ defaultExpandedDepth: 2 }}
      />
    </>
  );
}

export function ArtifactsPanel({ core }: { core: OperatorCore }) {
  const [runIdRaw, setRunIdRaw] = React.useState("");
  const [artifactIdRaw, setArtifactIdRaw] = React.useState("");

  const runId = optionalString(runIdRaw);
  const artifactId = optionalString(artifactIdRaw);

  return (
    <Card data-testid="admin-http-artifacts-panel">
      <CardHeader>
        <div className="text-sm font-medium text-fg">Artifacts</div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Run id"
            placeholder="uuid"
            value={runIdRaw}
            onChange={(event) => {
              setRunIdRaw(event.target.value);
            }}
          />
          <Input
            label="Artifact id"
            placeholder="artifact-..."
            value={artifactIdRaw}
            onChange={(event) => {
              setArtifactIdRaw(event.target.value);
            }}
          />
        </div>

        <Tabs defaultValue="metadata" className="grid gap-3">
          <TabsList aria-label="Artifact endpoints">
            <TabsTrigger value="metadata">Metadata</TabsTrigger>
            <TabsTrigger value="download">Download</TabsTrigger>
          </TabsList>

          <TabsContent value="metadata" forceMount className="grid gap-3">
            <ArtifactsMetadataTab core={core} runId={runId} artifactId={artifactId} />
          </TabsContent>

          <TabsContent value="download" forceMount className="grid gap-3">
            <ArtifactsDownloadTab core={core} runId={runId} artifactId={artifactId} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
