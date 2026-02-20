import type { ArtifactKind, ArtifactRef as ArtifactRefT } from "@tyrum/schemas";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { RedactionEngine } from "../redaction/engine.js";

export interface ArtifactPutInput {
  artifact_id?: string;
  kind: ArtifactKind;
  body: Buffer;
  created_at?: string;
  mime_type?: string;
  labels?: string[];
  metadata?: unknown;
}

export interface ArtifactGetResult {
  ref: ArtifactRefT;
  body: Buffer;
}

export interface ArtifactStore {
  put(input: ArtifactPutInput): Promise<ArtifactRefT>;
  get(artifactId: string): Promise<ArtifactGetResult | null>;
}

function isTextLikeMime(mimeType: string): boolean {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json") return true;
  if (mime.endsWith("+json")) return true;
  if (mime === "application/xml") return true;
  if (mime.endsWith("+xml")) return true;
  return false;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function artifactUri(artifactId: string): `artifact://${string}` {
  return `artifact://${artifactId}`;
}

function artifactShard(artifactId: string): string {
  return artifactId.slice(0, 2).toLowerCase();
}

function buildRef(input: {
  artifact_id: string;
  kind: ArtifactKind;
  created_at: string;
  mime_type?: string;
  size_bytes?: number;
  sha256?: string;
  labels?: string[];
  metadata?: unknown;
}): ArtifactRefT {
  return {
    artifact_id: input.artifact_id,
    uri: artifactUri(input.artifact_id),
    kind: input.kind,
    created_at: input.created_at,
    mime_type: input.mime_type,
    size_bytes: input.size_bytes,
    sha256: input.sha256,
    labels: input.labels ?? [],
    metadata: input.metadata,
  };
}

export class FsArtifactStore implements ArtifactStore {
  constructor(
    private readonly baseDir: string,
    private readonly redactionEngine?: RedactionEngine,
  ) {}

  private paths(artifactId: string): { dir: string; dataPath: string; metaPath: string } {
    const shard = artifactShard(artifactId);
    const dir = join(this.baseDir, shard);
    return {
      dir,
      dataPath: join(dir, `${artifactId}.bin`),
      metaPath: join(dir, `${artifactId}.json`),
    };
  }

  async put(input: ArtifactPutInput): Promise<ArtifactRefT> {
    const artifactId = input.artifact_id ?? randomUUID();
    const createdAt = input.created_at ?? new Date().toISOString();
    const mimeType = input.mime_type?.trim() || undefined;

    let body = input.body;
    if (this.redactionEngine && mimeType && isTextLikeMime(mimeType)) {
      const { redacted } = this.redactionEngine.redactText(body.toString("utf8"));
      body = Buffer.from(redacted, "utf8");
    }

    const sizeBytes = body.byteLength;
    const sha256 = sha256Hex(body);
    const ref = buildRef({
      artifact_id: artifactId,
      kind: input.kind,
      created_at: createdAt,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      sha256,
      labels: input.labels,
      metadata: input.metadata,
    });

    const { dir, dataPath, metaPath } = this.paths(artifactId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(dataPath, body, { mode: 0o600 });
    await writeFile(metaPath, JSON.stringify(ref), { mode: 0o600 });
    return ref;
  }

  async get(artifactId: string): Promise<ArtifactGetResult | null> {
    const { dataPath, metaPath } = this.paths(artifactId);
    try {
      const [body, metaRaw] = await Promise.all([
        readFile(dataPath),
        readFile(metaPath, "utf8"),
      ]);
      const ref = JSON.parse(metaRaw) as ArtifactRefT;
      return { ref, body };
    } catch (err) {
      const code = err && typeof err === "object" ? (err as { code?: string }).code : undefined;
      if (code === "ENOENT") return null;
      throw err;
    }
  }
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.from("");
  const anyBody = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof anyBody.transformToByteArray === "function") {
    const bytes = await anyBody.transformToByteArray();
    return Buffer.from(bytes);
  }

  // Fallback: attempt to consume Node Readable.
  const chunks: Buffer[] = [];
  const readable = body as AsyncIterable<Uint8Array>;
  for await (const chunk of readable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class S3ArtifactStore implements ArtifactStore {
  private bucketEnsured: Promise<void> | undefined;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly keyPrefix = "artifacts",
    private readonly redactionEngine?: RedactionEngine,
  ) {}

  private keyFor(artifactId: string, suffix: ".bin" | ".json"): string {
    const shard = artifactShard(artifactId);
    return `${this.keyPrefix}/${shard}/${artifactId}${suffix}`;
  }

  private async ensureBucketOnce(): Promise<void> {
    if (this.bucketEnsured) return this.bucketEnsured;
    // Lazy — avoid any startup dependency on object storage.
    this.bucketEnsured = Promise.resolve();
    return this.bucketEnsured;
  }

  async put(input: ArtifactPutInput): Promise<ArtifactRefT> {
    await this.ensureBucketOnce();

    const artifactId = input.artifact_id ?? randomUUID();
    const createdAt = input.created_at ?? new Date().toISOString();
    const mimeType = input.mime_type?.trim() || undefined;

    let body = input.body;
    if (this.redactionEngine && mimeType && isTextLikeMime(mimeType)) {
      const { redacted } = this.redactionEngine.redactText(body.toString("utf8"));
      body = Buffer.from(redacted, "utf8");
    }

    const sizeBytes = body.byteLength;
    const sha256 = sha256Hex(body);
    const ref = buildRef({
      artifact_id: artifactId,
      kind: input.kind,
      created_at: createdAt,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      sha256,
      labels: input.labels,
      metadata: input.metadata,
    });

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.keyFor(artifactId, ".bin"),
        Body: body,
        ContentType: mimeType ?? "application/octet-stream",
      }),
    );

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.keyFor(artifactId, ".json"),
        Body: JSON.stringify(ref),
        ContentType: "application/json",
      }),
    );

    return ref;
  }

  async get(artifactId: string): Promise<ArtifactGetResult | null> {
    await this.ensureBucketOnce();

    try {
      const [metaRes, dataRes] = await Promise.all([
        this.client.send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: this.keyFor(artifactId, ".json"),
          }),
        ),
        this.client.send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: this.keyFor(artifactId, ".bin"),
          }),
        ),
      ]);

      const [metaBuf, bodyBuf] = await Promise.all([
        bodyToBuffer(metaRes.Body),
        bodyToBuffer(dataRes.Body),
      ]);

      const ref = JSON.parse(metaBuf.toString("utf8")) as ArtifactRefT;
      return { ref, body: bodyBuf };
    } catch (err) {
      const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
      const code = err && typeof err === "object" ? (err as { Code?: string; code?: string }).Code ?? (err as { code?: string }).code : undefined;
      if (name === "NoSuchKey" || code === "NoSuchKey") return null;
      throw err;
    }
  }
}

