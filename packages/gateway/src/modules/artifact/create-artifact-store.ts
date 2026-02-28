import { S3Client } from "@aws-sdk/client-s3";
import { loadConfigFromProcessEnv } from "../../config.js";
import type { GatewayConfig } from "../../config.js";
import type { RedactionEngine } from "../redaction/engine.js";
import type { ArtifactStore } from "./store.js";
import { FsArtifactStore, S3ArtifactStore } from "./store.js";

export function createArtifactStore(
  artifacts: GatewayConfig["artifacts"],
  redactionEngine: RedactionEngine,
): ArtifactStore {
  if (artifacts.store === "s3") {
    const client = new S3Client({
      region: artifacts.s3.region,
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
    return new S3ArtifactStore(client, artifacts.s3.bucket, "artifacts", redactionEngine);
  }

  return new FsArtifactStore(artifacts.dir, redactionEngine);
}

export function createArtifactStoreFromEnv(
  tyrumHome: string,
  redactionEngine: RedactionEngine,
): ArtifactStore {
  const config = loadConfigFromProcessEnv({
    GATEWAY_TOKEN: "artifact-store-token",
    TYRUM_HOME: tyrumHome,
  });
  return createArtifactStore(config.artifacts, redactionEngine);
}
