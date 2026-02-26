import {
  AgentId,
  ArtifactId,
  ArtifactRef,
  ExecutionAttemptId,
  ExecutionRunId,
  ExecutionStepId,
  PolicySnapshotId,
  WorkspaceId,
} from "@tyrum/schemas";
import { z } from "zod";
import {
  HttpTransport,
  NonEmptyString,
  TyrumHttpClientError,
  validateOrThrow,
  type TyrumRequestOptions,
} from "./shared.js";

const ArtifactMetadataResponse = z
  .object({
    artifact: ArtifactRef,
    scope: z
      .object({
        workspace_id: WorkspaceId,
        agent_id: AgentId.nullable(),
        run_id: ExecutionRunId,
        step_id: ExecutionStepId.nullable(),
        attempt_id: ExecutionAttemptId.nullable(),
        sensitivity: NonEmptyString,
        policy_snapshot_id: PolicySnapshotId.nullable(),
      })
      .strict(),
  })
  .strict();

export type ArtifactMetadataResponse = z.infer<typeof ArtifactMetadataResponse>;

export type ArtifactBytesResult =
  | {
      kind: "bytes";
      bytes: Uint8Array;
      contentType?: string;
    }
  | {
      kind: "redirect";
      url: string;
    };

export interface ArtifactsApi {
  getMetadata(
    runId: string,
    artifactId: string,
    options?: TyrumRequestOptions,
  ): Promise<ArtifactMetadataResponse>;
  getBytes(runId: string, artifactId: string, options?: TyrumRequestOptions): Promise<ArtifactBytesResult>;
}

export function createArtifactsApi(transport: HttpTransport): ArtifactsApi {
  return {
    async getMetadata(runId, artifactId, options) {
      const parsedRunId = validateOrThrow(ExecutionRunId, runId, "run id");
      const parsedArtifactId = validateOrThrow(ArtifactId, artifactId, "artifact id");

      return await transport.request({
        method: "GET",
        path: `/runs/${encodeURIComponent(parsedRunId)}/artifacts/${encodeURIComponent(parsedArtifactId)}/metadata`,
        response: ArtifactMetadataResponse,
        signal: options?.signal,
      });
    },

    async getBytes(runId, artifactId, options) {
      const parsedRunId = validateOrThrow(ExecutionRunId, runId, "run id");
      const parsedArtifactId = validateOrThrow(ArtifactId, artifactId, "artifact id");
      const path = `/runs/${encodeURIComponent(parsedRunId)}/artifacts/${encodeURIComponent(parsedArtifactId)}`;

      const response = await transport.requestRaw({
        method: "GET",
        path,
        expectedStatus: [200, 302],
        redirect: "manual",
        signal: options?.signal,
      });

      if ((response as { type?: string }).type === "opaqueredirect") {
        return { kind: "redirect", url: transport.urlFor(path) };
      }

      if (response.status === 302) {
        const location = response.headers.get("location")?.trim();
        if (!location) {
          throw new TyrumHttpClientError("response_invalid", "redirect location is missing", {
            status: response.status,
          });
        }
        return { kind: "redirect", url: location };
      }

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get("content-type")?.trim() || undefined;
      return {
        kind: "bytes",
        bytes: new Uint8Array(buffer),
        contentType,
      };
    },
  };
}
