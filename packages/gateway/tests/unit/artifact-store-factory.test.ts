import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { createArtifactStore } from "../../src/modules/artifact/create-artifact-store.js";
import { FsArtifactStore, S3ArtifactStore } from "../../src/modules/artifact/store.js";
import { RedactionEngine } from "../../src/modules/redaction/engine.js";

describe("createArtifactStore", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "tyrum-artifact-store-factory-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("creates filesystem store rooted at configured artifacts.dir", async () => {
    const artifactsDir = join(homeDir, "artifacts");

    const store = createArtifactStore(
      {
        store: "fs",
        dir: artifactsDir,
        s3: {},
      },
      new RedactionEngine(),
    );
    expect(store).toBeInstanceOf(FsArtifactStore);

    await store.put({
      kind: "log",
      body: Buffer.from("hello", "utf8"),
      mime_type: "text/plain",
    });

    expect(existsSync(artifactsDir)).toBe(true);
    expect(readdirSync(artifactsDir).length).toBeGreaterThan(0);
  });

  it("throws when artifacts.store=fs and artifacts.dir is missing", () => {
    expect(() =>
      createArtifactStore(
        {
          store: "fs",
          s3: {},
        },
        new RedactionEngine(),
      ),
    ).toThrow(/artifacts\.dir is required/i);
  });

  it("selects S3 store when artifacts.store=s3", () => {
    const store = createArtifactStore(
      {
        store: "s3",
        s3: {
          accessKeyId: "test",
          secretAccessKey: "test",
        },
      },
      new RedactionEngine(),
    );
    expect(store).toBeInstanceOf(S3ArtifactStore);
  });
});
