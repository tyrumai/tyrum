import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { createArtifactStoreFromEnv } from "../../src/modules/artifact/create-artifact-store.js";
import { FsArtifactStore, S3ArtifactStore } from "../../src/modules/artifact/store.js";
import { RedactionEngine } from "../../src/modules/redaction/engine.js";

const ENV_KEYS = [
  "TYRUM_ARTIFACT_STORE",
  "TYRUM_ARTIFACTS_DIR",
  "TYRUM_ARTIFACTS_S3_ACCESS_KEY_ID",
  "TYRUM_ARTIFACTS_S3_SECRET_ACCESS_KEY",
] as const;

function snapshotEnv(): Record<(typeof ENV_KEYS)[number], string | undefined> {
  const snapshot = {} as Record<(typeof ENV_KEYS)[number], string | undefined>;
  for (const key of ENV_KEYS) snapshot[key] = process.env[key];
  return snapshot;
}

function restoreEnv(snapshot: Record<(typeof ENV_KEYS)[number], string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("createArtifactStoreFromEnv", () => {
  let homeDir: string;
  let envSnapshot: Record<(typeof ENV_KEYS)[number], string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
    homeDir = mkdtempSync(join(tmpdir(), "tyrum-artifact-store-factory-"));
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("defaults to filesystem store rooted at TYRUM_HOME/artifacts", async () => {
    delete process.env["TYRUM_ARTIFACT_STORE"];
    delete process.env["TYRUM_ARTIFACTS_DIR"];

    const store = createArtifactStoreFromEnv(homeDir, new RedactionEngine());
    expect(store).toBeInstanceOf(FsArtifactStore);

    await store.put({
      kind: "log",
      body: Buffer.from("hello", "utf8"),
      mime_type: "text/plain",
    });

    const baseDir = join(homeDir, "artifacts");
    expect(existsSync(baseDir)).toBe(true);
    expect(readdirSync(baseDir).length).toBeGreaterThan(0);
  });

  it("honors TYRUM_ARTIFACTS_DIR when using filesystem store", async () => {
    delete process.env["TYRUM_ARTIFACT_STORE"];
    const customDir = join(homeDir, "custom-artifacts");
    process.env["TYRUM_ARTIFACTS_DIR"] = customDir;

    const store = createArtifactStoreFromEnv(homeDir, new RedactionEngine());
    expect(store).toBeInstanceOf(FsArtifactStore);

    await store.put({
      kind: "log",
      body: Buffer.from("hello", "utf8"),
      mime_type: "text/plain",
    });

    expect(existsSync(customDir)).toBe(true);
    expect(readdirSync(customDir).length).toBeGreaterThan(0);
  });

  it("selects S3 store when TYRUM_ARTIFACT_STORE=s3", () => {
    process.env["TYRUM_ARTIFACT_STORE"] = "s3";
    process.env["TYRUM_ARTIFACTS_S3_ACCESS_KEY_ID"] = "test";
    process.env["TYRUM_ARTIFACTS_S3_SECRET_ACCESS_KEY"] = "test";

    const store = createArtifactStoreFromEnv(homeDir, new RedactionEngine());
    expect(store).toBeInstanceOf(S3ArtifactStore);
  });
});
