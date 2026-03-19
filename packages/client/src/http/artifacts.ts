import { ArtifactId, ArtifactRef } from "@tyrum/contracts";
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
    sensitivity: NonEmptyString,
    links: z
      .array(
        z
          .object({
            parent_kind: NonEmptyString,
            parent_id: NonEmptyString,
          })
          .strict(),
      )
      .default([]),
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
      /**
       * Signed URL when available (for example Node fetch + manual redirects).
       *
       * Browser fetch implementations return an opaque redirect response for
       * `redirect: "manual"`; in that case this falls back to the gateway
       * artifact URL, which is still usable for navigation/download flows.
       */
      url: string;
    };

export interface ArtifactsApi {
  getMetadata(artifactId: string, options?: TyrumRequestOptions): Promise<ArtifactMetadataResponse>;
  getBytes(artifactId: string, options?: TyrumRequestOptions): Promise<ArtifactBytesResult>;
}

export function createArtifactsApi(transport: HttpTransport): ArtifactsApi {
  return {
    async getMetadata(artifactId, options) {
      const parsedArtifactId = validateOrThrow(ArtifactId, artifactId, "artifact id");

      return await transport.request({
        method: "GET",
        path: `/artifacts/${encodeURIComponent(parsedArtifactId)}/metadata`,
        response: ArtifactMetadataResponse,
        signal: options?.signal,
      });
    },

    async getBytes(artifactId, options) {
      const parsedArtifactId = validateOrThrow(ArtifactId, artifactId, "artifact id");
      const path = `/a/${encodeURIComponent(parsedArtifactId)}`;

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
