import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FsArtifactStore, S3ArtifactStore } from "../../src/modules/artifact/store.js";
import { RedactionEngine } from "../../src/modules/redaction/engine.js";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

describe("ArtifactStore", () => {
  const publicBaseUrl = "https://gateway.example.test";
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "tyrum-artifacts-test-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("filesystem store: put -> get round-trip", async () => {
    const store = new FsArtifactStore(baseDir, undefined, publicBaseUrl);
    const ref = await store.put({
      kind: "log",
      body: Buffer.from("hello world", "utf8"),
      mime_type: "text/plain",
      labels: ["unit"],
    });

    expect(ref.uri).toBe(`artifact://${ref.artifact_id}`);
    expect(ref.external_url).toBe(`${publicBaseUrl}/a/${ref.artifact_id}`);
    expect(ref.media_class).toBe("document");
    expect(ref.filename).toBe(`artifact-${ref.artifact_id}.txt`);
    expect(ref.size_bytes).toBeGreaterThan(0);
    expect(ref.sha256).toMatch(/^[0-9a-f]{64}$/i);

    const got = await store.get(ref.artifact_id);
    expect(got).not.toBeNull();
    expect(got!.body.toString("utf8")).toBe("hello world");
    expect(got!.ref.kind).toBe("log");
  });

  it("filesystem store: redacts secrets for text-like artifacts when configured", async () => {
    const redaction = new RedactionEngine();
    redaction.registerSecrets(["secret-123"]);
    const store = new FsArtifactStore(baseDir, redaction, publicBaseUrl);

    const ref = await store.put({
      kind: "log",
      body: Buffer.from("token=secret-123", "utf8"),
      mime_type: "text/plain",
    });

    const got = await store.get(ref.artifact_id);
    expect(got).not.toBeNull();
    expect(got!.body.toString("utf8")).toContain("[REDACTED]");
    expect(got!.body.toString("utf8")).not.toContain("secret-123");
  });

  it("filesystem store: returns null for missing artifact", async () => {
    const store = new FsArtifactStore(baseDir, undefined, publicBaseUrl);
    const got = await store.get("550e8400-e29b-41d4-a716-446655440000");
    expect(got).toBeNull();
  });

  it("filesystem store: reads legacy metadata missing derived fields", async () => {
    const store = new FsArtifactStore(baseDir, undefined, publicBaseUrl);
    const artifactId = "550e8400-e29b-41d4-a716-446655440000";
    const shardDir = join(baseDir, artifactId.slice(0, 2));
    mkdirSync(shardDir, { recursive: true });
    writeFileSync(join(shardDir, `${artifactId}.bin`), "hello");
    writeFileSync(
      join(shardDir, `${artifactId}.json`),
      JSON.stringify({
        artifact_id: artifactId,
        uri: `artifact://${artifactId}`,
        kind: "log",
        created_at: "2026-02-19T12:00:00.000Z",
        mime_type: "text/plain",
        size_bytes: 5,
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        labels: ["legacy"],
      }),
    );

    const got = await store.get(artifactId);
    expect(got).not.toBeNull();
    expect(got!.ref.external_url).toBe(`${publicBaseUrl}/a/${artifactId}`);
    expect(got!.ref.media_class).toBe("document");
    expect(got!.ref.filename).toBe(`artifact-${artifactId}.txt`);
    expect(got!.ref.labels).toEqual(["legacy"]);
    expect(got!.body.toString("utf8")).toBe("hello");
  });

  it("s3 store: put -> get uses deterministic keys", async () => {
    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof PutObjectCommand) {
        return {};
      }
      if (cmd instanceof GetObjectCommand) {
        const key = cmd.input.Key ?? "";
        if (key === "artifacts/manifests/55/550e8400-e29b-41d4-a716-446655440000.json") {
          const meta = JSON.stringify({
            v: 1,
            ref: {
              artifact_id: "550e8400-e29b-41d4-a716-446655440000",
              uri: "artifact://550e8400-e29b-41d4-a716-446655440000",
              external_url: `${publicBaseUrl}/a/550e8400-e29b-41d4-a716-446655440000`,
              kind: "log",
              media_class: "document",
              created_at: "2026-02-19T12:00:00.000Z",
              filename: "artifact-550e8400-e29b-41d4-a716-446655440000.txt",
              labels: [],
              sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
              size_bytes: 5,
              mime_type: "text/plain",
            },
            blob_key:
              "artifacts/blobs/55/550e8400-e29b-41d4-a716-446655440000/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.bin",
          });
          return {
            Body: {
              transformToByteArray: async () => Buffer.from(meta, "utf8"),
            },
          };
        }
        return {
          Body: {
            transformToByteArray: async () => Buffer.from("hello", "utf8"),
          },
        };
      }
      throw new Error("unexpected command");
    });

    const store = new S3ArtifactStore(
      { send } as unknown as import("@aws-sdk/client-s3").S3Client,
      "bucket",
      "artifacts",
      undefined,
      publicBaseUrl,
    );

    const ref = await store.put({
      artifact_id: "550e8400-e29b-41d4-a716-446655440000",
      kind: "log",
      body: Buffer.from("hello", "utf8"),
      mime_type: "text/plain",
    });

    expect(ref.uri).toBe("artifact://550e8400-e29b-41d4-a716-446655440000");
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: "bucket",
          Key: "artifacts/blobs/55/550e8400-e29b-41d4-a716-446655440000/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.bin",
        }),
      }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: "bucket",
          Key: "artifacts/manifests/55/550e8400-e29b-41d4-a716-446655440000.json",
        }),
      }),
    );

    const got = await store.get("550e8400-e29b-41d4-a716-446655440000");
    expect(got).not.toBeNull();
    expect(got!.body.toString("utf8")).toBe("hello");
    expect(got!.ref.kind).toBe("log");
  });

  it("s3 store: reads legacy manifests missing derived ref fields", async () => {
    const artifactId = "550e8400-e29b-41d4-a716-446655440000";
    const manifestKey = `artifacts/manifests/55/${artifactId}.json`;
    const blobKey = `artifacts/blobs/55/${artifactId}/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.bin`;
    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof GetObjectCommand) {
        const key = cmd.input.Key ?? "";
        if (key === manifestKey) {
          const meta = JSON.stringify({
            v: 1,
            ref: {
              artifact_id: artifactId,
              uri: `artifact://${artifactId}`,
              kind: "log",
              created_at: "2026-02-19T12:00:00.000Z",
              labels: [],
              sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
              size_bytes: 5,
              mime_type: "text/plain",
            },
            blob_key: blobKey,
          });
          return {
            Body: {
              transformToByteArray: async () => Buffer.from(meta, "utf8"),
            },
          };
        }
        if (key === blobKey) {
          return {
            Body: {
              transformToByteArray: async () => Buffer.from("hello", "utf8"),
            },
          };
        }
      }
      throw new Error("unexpected command");
    });

    const store = new S3ArtifactStore(
      { send } as unknown as import("@aws-sdk/client-s3").S3Client,
      "bucket",
      "artifacts",
      undefined,
      publicBaseUrl,
    );

    const got = await store.get(artifactId);
    expect(got).not.toBeNull();
    expect(got!.ref.external_url).toBe(`${publicBaseUrl}/a/${artifactId}`);
    expect(got!.ref.media_class).toBe("document");
    expect(got!.ref.filename).toBe(`artifact-${artifactId}.txt`);
    expect(got!.body.toString("utf8")).toBe("hello");
  });

  it("s3 store: get returns null when manifest is missing", async () => {
    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof GetObjectCommand) {
        const key = cmd.input.Key ?? "";
        if (key === "artifacts/manifests/55/550e8400-e29b-41d4-a716-446655440000.json") {
          const err = Object.assign(new Error("not found"), { name: "NoSuchKey" });
          throw err;
        }
      }
      throw new Error("unexpected command");
    });

    const store = new S3ArtifactStore(
      { send } as unknown as import("@aws-sdk/client-s3").S3Client,
      "bucket",
      "artifacts",
      undefined,
      publicBaseUrl,
    );

    const got = await store.get("550e8400-e29b-41d4-a716-446655440000");
    expect(got).toBeNull();

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Bucket: "bucket",
          Key: "artifacts/manifests/55/550e8400-e29b-41d4-a716-446655440000.json",
        }),
      }),
    );
  });

  it("s3 store: getSignedUrl presigns manifest-backed blob keys", async () => {
    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof GetObjectCommand) {
        const key = cmd.input.Key ?? "";
        if (key === "artifacts/manifests/55/550e8400-e29b-41d4-a716-446655440000.json") {
          const meta = JSON.stringify({
            v: 1,
            ref: {
              artifact_id: "550e8400-e29b-41d4-a716-446655440000",
              uri: "artifact://550e8400-e29b-41d4-a716-446655440000",
              external_url: `${publicBaseUrl}/a/550e8400-e29b-41d4-a716-446655440000`,
              kind: "log",
              media_class: "document",
              created_at: "2026-02-19T12:00:00.000Z",
              filename: "artifact-550e8400-e29b-41d4-a716-446655440000.txt",
              labels: [],
              sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
              size_bytes: 5,
              mime_type: "text/plain",
            },
            blob_key:
              "artifacts/blobs/55/550e8400-e29b-41d4-a716-446655440000/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.bin",
          });
          return {
            Body: {
              transformToByteArray: async () => Buffer.from(meta, "utf8"),
            },
          };
        }
      }

      if (cmd instanceof HeadObjectCommand) {
        return {};
      }

      throw new Error("unexpected command");
    });

    const presignGetObject = vi.fn(async () => "https://objects.example.test/signed?sig=test");

    const store = new S3ArtifactStore(
      { send } as unknown as import("@aws-sdk/client-s3").S3Client,
      "bucket",
      "artifacts",
      undefined,
      publicBaseUrl,
      presignGetObject,
    );

    const url = await store.getSignedUrl("550e8400-e29b-41d4-a716-446655440000", {
      expiresInSeconds: 42,
    });

    expect(url).toBe("https://objects.example.test/signed?sig=test");
    expect(presignGetObject).toHaveBeenCalledWith({
      bucket: "bucket",
      key: "artifacts/blobs/55/550e8400-e29b-41d4-a716-446655440000/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.bin",
      expiresInSeconds: 42,
    });
  });

  it("s3 store: getSignedUrl returns null when manifest exists but blob is missing (no legacy fallback)", async () => {
    const artifactId = "550e8400-e29b-41d4-a716-446655440000";
    const manifestKey = "artifacts/manifests/55/550e8400-e29b-41d4-a716-446655440000.json";
    const blobKey =
      "artifacts/blobs/55/550e8400-e29b-41d4-a716-446655440000/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.bin";
    const legacyKey = "artifacts/55/550e8400-e29b-41d4-a716-446655440000.bin";

    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof GetObjectCommand) {
        const key = cmd.input.Key ?? "";
        if (key === manifestKey) {
          const meta = JSON.stringify({
            v: 1,
            ref: {
              artifact_id: artifactId,
              uri: `artifact://${artifactId}`,
              external_url: `${publicBaseUrl}/a/${artifactId}`,
              kind: "log",
              media_class: "document",
              created_at: "2026-02-19T12:00:00.000Z",
              filename: `artifact-${artifactId}.txt`,
              labels: [],
              sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
              size_bytes: 5,
              mime_type: "text/plain",
            },
            blob_key: blobKey,
          });
          return {
            Body: {
              transformToByteArray: async () => Buffer.from(meta, "utf8"),
            },
          };
        }
      }

      if (cmd instanceof HeadObjectCommand) {
        const key = cmd.input.Key ?? "";
        if (key === blobKey) {
          const err = Object.assign(new Error("not found"), { name: "NotFound" });
          throw err;
        }
        if (key === legacyKey) {
          return {};
        }
      }

      throw new Error("unexpected command");
    });

    const presignGetObject = vi.fn(async () => "https://objects.example.test/signed?sig=test");

    const store = new S3ArtifactStore(
      { send } as unknown as import("@aws-sdk/client-s3").S3Client,
      "bucket",
      "artifacts",
      undefined,
      publicBaseUrl,
      presignGetObject,
    );

    const url = await store.getSignedUrl(artifactId);
    expect(url).toBeNull();
    expect(presignGetObject).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          Key: legacyKey,
        }),
      }),
    );
  });

  it("s3 store: getSignedUrl presigns even when HeadObject is blocked", async () => {
    const artifactId = "550e8400-e29b-41d4-a716-446655440000";
    const manifestKey = "artifacts/manifests/55/550e8400-e29b-41d4-a716-446655440000.json";
    const blobKey =
      "artifacts/blobs/55/550e8400-e29b-41d4-a716-446655440000/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.bin";

    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof GetObjectCommand) {
        const key = cmd.input.Key ?? "";
        if (key === manifestKey) {
          const meta = JSON.stringify({
            v: 1,
            ref: {
              artifact_id: artifactId,
              uri: `artifact://${artifactId}`,
              external_url: `${publicBaseUrl}/a/${artifactId}`,
              kind: "log",
              media_class: "document",
              created_at: "2026-02-19T12:00:00.000Z",
              filename: `artifact-${artifactId}.txt`,
              labels: [],
              sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
              size_bytes: 5,
              mime_type: "text/plain",
            },
            blob_key: blobKey,
          });
          return {
            Body: {
              transformToByteArray: async () => Buffer.from(meta, "utf8"),
            },
          };
        }
      }

      if (cmd instanceof HeadObjectCommand) {
        const key = cmd.input.Key ?? "";
        if (key === blobKey) {
          const err = Object.assign(new Error("forbidden"), { name: "AccessDenied" });
          throw err;
        }
      }

      throw new Error("unexpected command");
    });

    const presignGetObject = vi.fn(async () => "https://objects.example.test/signed?sig=test");

    const store = new S3ArtifactStore(
      { send } as unknown as import("@aws-sdk/client-s3").S3Client,
      "bucket",
      "artifacts",
      undefined,
      publicBaseUrl,
      presignGetObject,
    );

    const url = await store.getSignedUrl(artifactId, { expiresInSeconds: 42 });
    expect(url).toBe("https://objects.example.test/signed?sig=test");
    expect(presignGetObject).toHaveBeenCalledWith({
      bucket: "bucket",
      key: blobKey,
      expiresInSeconds: 42,
    });
  });

  it("s3 store: getSignedUrl throws when manifest is malformed", async () => {
    const artifactId = "550e8400-e29b-41d4-a716-446655440000";
    const manifestKey = "artifacts/manifests/55/550e8400-e29b-41d4-a716-446655440000.json";

    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof GetObjectCommand) {
        const key = cmd.input.Key ?? "";
        if (key === manifestKey) {
          return {
            Body: {
              transformToByteArray: async () => Buffer.from("{not-json", "utf8"),
            },
          };
        }
      }

      throw new Error("unexpected command");
    });

    const store = new S3ArtifactStore(
      { send } as unknown as import("@aws-sdk/client-s3").S3Client,
      "bucket",
      "artifacts",
      undefined,
      publicBaseUrl,
    );

    await expect(store.getSignedUrl(artifactId, { expiresInSeconds: 42 })).rejects.toThrow(
      "invalid artifact manifest",
    );
  });

  it("s3 store: getSignedUrl returns null when manifest is missing", async () => {
    const artifactId = "550e8400-e29b-41d4-a716-446655440000";
    const manifestKey = "artifacts/manifests/55/550e8400-e29b-41d4-a716-446655440000.json";

    const send = vi.fn(async (cmd: unknown) => {
      if (cmd instanceof GetObjectCommand) {
        const key = cmd.input.Key ?? "";
        if (key === manifestKey) {
          const err = Object.assign(new Error("not found"), { name: "NoSuchKey" });
          throw err;
        }
      }

      throw new Error("unexpected command");
    });

    const presignGetObject = vi.fn(async () => "https://objects.example.test/signed?sig=test");

    const store = new S3ArtifactStore(
      { send } as unknown as import("@aws-sdk/client-s3").S3Client,
      "bucket",
      "artifacts",
      undefined,
      publicBaseUrl,
      presignGetObject,
    );

    const url = await store.getSignedUrl(artifactId);
    expect(url).toBeNull();
    expect(presignGetObject).not.toHaveBeenCalled();
  });
});
