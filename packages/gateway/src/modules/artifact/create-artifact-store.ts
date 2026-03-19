import { S3Client } from "@aws-sdk/client-s3";
import type { DeploymentConfigArtifacts } from "@tyrum/contracts";
import type { RedactionEngine } from "../redaction/engine.js";
import type { ArtifactStore } from "./store.js";
import { FsArtifactStore, S3ArtifactStore } from "./store.js";

export function createArtifactStore(
  artifacts: DeploymentConfigArtifacts,
  redactionEngine: RedactionEngine,
): ArtifactStore {
  if (artifacts.store === "s3") {
    const bucket = artifacts.s3.bucket ?? "tyrum-artifacts";
    const region = artifacts.s3.region ?? "us-east-1";
    const client = new S3Client({
      region,
      endpoint: artifacts.s3.endpoint,
      forcePathStyle: artifacts.s3.forcePathStyle,
      credentials:
        artifacts.s3.accessKeyId && artifacts.s3.secretAccessKey
          ? {
              accessKeyId: artifacts.s3.accessKeyId,
              secretAccessKey: artifacts.s3.secretAccessKey,
              sessionToken: artifacts.s3.sessionToken,
            }
          : undefined,
    });
    return new S3ArtifactStore(client, bucket, "artifacts", redactionEngine);
  }

  if (!artifacts.dir) {
    throw new Error("artifacts.dir is required when artifacts.store=fs");
  }
  return new FsArtifactStore(artifacts.dir, redactionEngine);
}
