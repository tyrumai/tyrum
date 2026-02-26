import { ArtifactId, ArtifactRef } from "@tyrum/schemas";
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
        workspace_id: NonEmptyString,
        agent_id: NonEmptyString.nullable(),
        run_id: NonEmptyString,
        step_id: NonEmptyString.nullable(),
        attempt_id: NonEmptyString.nullable(),
        sensitivity: NonEmptyString,
        policy_snapshot_id: NonEmptyString.nullable(),
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
      const parsedRunId = validateOrThrow(NonEmptyString, runId, "run id");
      const parsedArtifactId = validateOrThrow(ArtifactId, artifactId, "artifact id");

      return await transport.request({
        method: "GET",
        path: `/runs/${encodeURIComponent(parsedRunId)}/artifacts/${encodeURIComponent(parsedArtifactId)}/metadata`,
        response: ArtifactMetadataResponse,
        signal: options?.signal,
      });
    },

    async getBytes(runId, artifactId, options) {
      const parsedRunId = validateOrThrow(NonEmptyString, runId, "run id");
      const parsedArtifactId = validateOrThrow(ArtifactId, artifactId, "artifact id");

      const response = await transport.requestRaw({
        method: "GET",
        path: `/runs/${encodeURIComponent(parsedRunId)}/artifacts/${encodeURIComponent(parsedArtifactId)}`,
        expectedStatus: [200, 302],
        redirect: "manual",
        signal: options?.signal,
      });

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

