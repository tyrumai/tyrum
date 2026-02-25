import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import type { RedactionEngine } from "../redaction/engine.js";
import type { ArtifactStore } from "./store.js";
import { FsArtifactStore, S3ArtifactStore } from "./store.js";

export function createArtifactStoreFromEnv(
  tyrumHome: string,
  redactionEngine: RedactionEngine,
): ArtifactStore {
  const kind = process.env["TYRUM_ARTIFACT_STORE"]?.trim() || "fs";
  const fsDir = process.env["TYRUM_ARTIFACTS_DIR"]?.trim() || join(tyrumHome, "artifacts");

  if (kind === "s3") {
    const bucket = process.env["TYRUM_ARTIFACTS_S3_BUCKET"]?.trim() || "tyrum-artifacts";
    const region = process.env["TYRUM_ARTIFACTS_S3_REGION"]?.trim() || "us-east-1";
    const endpoint = process.env["TYRUM_ARTIFACTS_S3_ENDPOINT"]?.trim() || undefined;
    const forcePathStyleRaw = process.env["TYRUM_ARTIFACTS_S3_FORCE_PATH_STYLE"]?.trim();
    const forcePathStyle =
      forcePathStyleRaw !== undefined
        ? forcePathStyleRaw === "1" || forcePathStyleRaw.toLowerCase() === "true"
        : endpoint !== undefined;

    const accessKeyId = process.env["TYRUM_ARTIFACTS_S3_ACCESS_KEY_ID"]?.trim() || undefined;
    const secretAccessKey =
      process.env["TYRUM_ARTIFACTS_S3_SECRET_ACCESS_KEY"]?.trim() || undefined;
    const sessionToken = process.env["TYRUM_ARTIFACTS_S3_SESSION_TOKEN"]?.trim() || undefined;

    const client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials:
        accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey, sessionToken } : undefined,
    });
    return new S3ArtifactStore(client, bucket, "artifacts", redactionEngine);
  }

  return new FsArtifactStore(fsDir, redactionEngine);
}
