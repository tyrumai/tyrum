import {
  ArtifactKind,
  ArtifactRef,
  artifactFilenameFromMetadata,
  artifactMediaClassFromMimeType,
  type ArtifactRef as ArtifactRefT,
} from "@tyrum/contracts";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { RedactionEngine } from "../redaction/engine.js";

export interface ArtifactPutInput {
  artifact_id?: string;
  kind: ArtifactKind;
  body: Buffer;
  created_at?: string;
  mime_type?: string;
  filename?: string;
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
  delete(artifactId: string): Promise<void>;
  getSignedUrl?: (
    artifactId: string,
    opts?: { expiresInSeconds?: number },
  ) => Promise<string | null>;
}

type ArtifactManifestV1 = {
  v: 1;
  ref: ArtifactRefT;
  blob_key: string;
};

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

function buildExternalUrl(publicBaseUrl: string, accessId: string): string {
  return `${publicBaseUrl.replace(/\/$/, "")}/a/${accessId}`;
}

function artifactShard(artifactId: string): string {
  return artifactId.slice(0, 2).toLowerCase();
}

function buildRef(input: {
  artifact_id: string;
  public_base_url: string;
  kind: ArtifactKind;
  created_at: string;
  mime_type?: string;
  filename?: string;
  size_bytes?: number;
  sha256?: string;
  labels?: string[];
  metadata?: unknown;
}): ArtifactRefT {
  const filename = artifactFilenameFromMetadata({
    artifactId: input.artifact_id,
    kind: input.kind,
    filename: input.filename,
    mimeType: input.mime_type,
  });
  return {
    artifact_id: input.artifact_id,
    uri: artifactUri(input.artifact_id),
    external_url: buildExternalUrl(input.public_base_url, input.artifact_id),
    kind: input.kind,
    media_class: artifactMediaClassFromMimeType(input.mime_type, filename),
    created_at: input.created_at,
    filename,
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
    private readonly redactionEngine: RedactionEngine | undefined,
    private readonly publicBaseUrl: string,
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
      public_base_url: this.publicBaseUrl,
      kind: input.kind,
      created_at: createdAt,
      mime_type: mimeType,
      filename: input.filename?.trim() || undefined,
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
      const [body, metaRaw] = await Promise.all([readFile(dataPath), readFile(metaPath, "utf8")]);
      const ref = parseStoredArtifactRef({
        artifactId,
        publicBaseUrl: this.publicBaseUrl,
        candidate: JSON.parse(metaRaw) as unknown,
      });
      return { ref, body };
    } catch (err) {
      const code = err && typeof err === "object" ? (err as { code?: string }).code : undefined;
      if (code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(artifactId: string): Promise<void> {
    const { dataPath, metaPath } = this.paths(artifactId);
    const results = await Promise.allSettled([unlink(dataPath), unlink(metaPath)]);
    for (const res of results) {
      if (res.status === "fulfilled") continue;
      const code =
        res.reason && typeof res.reason === "object"
          ? (res.reason as { code?: string }).code
          : undefined;
      if (code === "ENOENT") continue;
      throw res.reason;
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

function isNoSuchKey(err: unknown): boolean {
  if (err instanceof S3ServiceException) {
    if (err.name === "NoSuchKey" || err.name === "NotFound") return true;
    if (err.$metadata.httpStatusCode === 404) return true;
  }
  const name = err && typeof err === "object" ? (err as { name?: string }).name : undefined;
  const code =
    err && typeof err === "object"
      ? ((err as { Code?: string; code?: string }).Code ?? (err as { code?: string }).code)
      : undefined;
  return name === "NoSuchKey" || name === "NotFound" || code === "NoSuchKey" || code === "NotFound";
}

type PresignGetObjectFn = (input: {
  bucket: string;
  key: string;
  expiresInSeconds: number;
}) => Promise<string>;

function parseStoredArtifactRef(input: {
  artifactId: string;
  publicBaseUrl: string;
  candidate: unknown;
}): ArtifactRefT {
  const parsed = ArtifactRef.safeParse(input.candidate);
  if (parsed.success) {
    if (parsed.data.artifact_id !== input.artifactId) {
      throw new Error(`invalid artifact metadata for ${input.artifactId}`);
    }
    return parsed.data;
  }

  if (!input.candidate || typeof input.candidate !== "object" || Array.isArray(input.candidate)) {
    throw new Error(`invalid artifact metadata for ${input.artifactId}`);
  }

  const maybe = input.candidate as Partial<ArtifactRefT> & {
    artifact_id?: unknown;
    kind?: unknown;
    created_at?: unknown;
    uri?: unknown;
    external_url?: unknown;
    media_class?: unknown;
    filename?: unknown;
    mime_type?: unknown;
    size_bytes?: unknown;
    sha256?: unknown;
    labels?: unknown;
    metadata?: unknown;
  };
  const artifactId = typeof maybe.artifact_id === "string" ? maybe.artifact_id : input.artifactId;
  if (artifactId !== input.artifactId) {
    throw new Error(`invalid artifact metadata for ${input.artifactId}`);
  }

  const kind = ArtifactKind.safeParse(maybe.kind);
  if (!kind.success || typeof maybe.created_at !== "string") {
    throw new Error(`invalid artifact metadata for ${input.artifactId}`);
  }

  const mimeType =
    typeof maybe.mime_type === "string" && maybe.mime_type.trim().length > 0
      ? maybe.mime_type.trim()
      : undefined;
  const filename = artifactFilenameFromMetadata({
    artifactId,
    kind: kind.data,
    filename: typeof maybe.filename === "string" ? maybe.filename : undefined,
    mimeType,
  });
  const normalized = {
    artifact_id: artifactId,
    uri: typeof maybe.uri === "string" ? maybe.uri : artifactUri(artifactId),
    external_url:
      typeof maybe.external_url === "string"
        ? maybe.external_url
        : buildExternalUrl(input.publicBaseUrl, artifactId),
    kind: kind.data,
    media_class:
      typeof maybe.media_class === "string" && maybe.media_class.trim().length > 0
        ? maybe.media_class
        : artifactMediaClassFromMimeType(mimeType, filename),
    created_at: maybe.created_at,
    filename,
    ...(mimeType ? { mime_type: mimeType } : {}),
    ...(typeof maybe.size_bytes === "number" ? { size_bytes: maybe.size_bytes } : {}),
    ...(typeof maybe.sha256 === "string" ? { sha256: maybe.sha256 } : {}),
    labels: Array.isArray(maybe.labels)
      ? maybe.labels.filter((label): label is string => typeof label === "string")
      : [],
    ...("metadata" in maybe ? { metadata: maybe.metadata } : {}),
  };

  try {
    return ArtifactRef.parse(normalized);
  } catch (err) {
    throw new Error(`invalid artifact metadata for ${input.artifactId}`, { cause: err });
  }
}

function parseArtifactManifest(
  artifactId: string,
  publicBaseUrl: string,
  candidate: unknown,
): ArtifactManifestV1 {
  const maybe = candidate as Partial<ArtifactManifestV1> | null;
  if (!maybe || maybe.v !== 1 || typeof maybe.blob_key !== "string" || !maybe.ref) {
    throw new Error(`invalid artifact manifest for ${artifactId}`);
  }
  let ref: ArtifactRefT;
  try {
    ref = parseStoredArtifactRef({
      artifactId,
      publicBaseUrl,
      candidate: maybe.ref,
    });
  } catch (err) {
    throw new Error(`invalid artifact manifest for ${artifactId}`, { cause: err });
  }
  return {
    v: 1,
    ref,
    blob_key: maybe.blob_key,
  };
}

function defaultPresignGetObject(client: S3Client): PresignGetObjectFn {
  return async ({ bucket, key, expiresInSeconds }) =>
    await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: expiresInSeconds,
    });
}

export class S3ArtifactStore implements ArtifactStore {
  private bucketEnsured: Promise<void> | undefined;
  private readonly presignGetObject: PresignGetObjectFn;

  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly keyPrefix = "artifacts",
    private readonly redactionEngine: RedactionEngine | undefined,
    private readonly publicBaseUrl: string,
    presignGetObject?: PresignGetObjectFn,
  ) {
    this.presignGetObject = presignGetObject ?? defaultPresignGetObject(client);
  }

  private manifestKeyFor(artifactId: string): string {
    const shard = artifactShard(artifactId);
    return `${this.keyPrefix}/manifests/${shard}/${artifactId}.json`;
  }

  private blobKeyFor(artifactId: string, sha256: string): string {
    const shard = artifactShard(artifactId);
    return `${this.keyPrefix}/blobs/${shard}/${artifactId}/${sha256}.bin`;
  }

  private async ensureBucketOnce(): Promise<void> {
    if (this.bucketEnsured) return this.bucketEnsured;
    // Lazy — avoid any startup dependency on object storage.
    this.bucketEnsured = Promise.resolve();
    return this.bucketEnsured;
  }

  private resolveExpiresInSeconds(opts?: { expiresInSeconds?: number }): number {
    const candidate = opts?.expiresInSeconds;
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0)
      return candidate;
    return 60;
  }

  async getSignedUrl(
    artifactId: string,
    opts?: { expiresInSeconds?: number },
  ): Promise<string | null> {
    await this.ensureBucketOnce();
    const expiresInSeconds = this.resolveExpiresInSeconds(opts);

    const manifestKey = this.manifestKeyFor(artifactId);
    let parsedManifest: ArtifactManifestV1;
    try {
      const manifestRes = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: manifestKey,
        }),
      );

      const manifestBuf = await bodyToBuffer(manifestRes.Body);
      let candidate: unknown;
      try {
        candidate = JSON.parse(manifestBuf.toString("utf8")) as unknown;
      } catch (err) {
        throw new Error(`invalid artifact manifest for ${artifactId}`, { cause: err });
      }
      parsedManifest = parseArtifactManifest(artifactId, this.publicBaseUrl, candidate);
    } catch (err) {
      if (isNoSuchKey(err)) return null;
      throw err;
    }

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: parsedManifest.blob_key,
        }),
      );
    } catch (err) {
      if (isNoSuchKey(err)) return null;
      // Best-effort: some S3-compatible deployments block HEAD while allowing GET.
    }

    return await this.presignGetObject({
      bucket: this.bucket,
      key: parsedManifest.blob_key,
      expiresInSeconds,
    });
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
      public_base_url: this.publicBaseUrl,
      kind: input.kind,
      created_at: createdAt,
      mime_type: mimeType,
      filename: input.filename?.trim() || undefined,
      size_bytes: sizeBytes,
      sha256,
      labels: input.labels,
      metadata: input.metadata,
    });

    const blobKey = this.blobKeyFor(artifactId, sha256);
    const manifestKey = this.manifestKeyFor(artifactId);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: blobKey,
        Body: body,
        ContentType: mimeType ?? "application/octet-stream",
      }),
    );

    const manifest: ArtifactManifestV1 = { v: 1, ref, blob_key: blobKey };
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: manifestKey,
        Body: JSON.stringify(manifest),
        ContentType: "application/json",
      }),
    );

    return ref;
  }

  async get(artifactId: string): Promise<ArtifactGetResult | null> {
    await this.ensureBucketOnce();

    try {
      const manifestRes = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.manifestKeyFor(artifactId),
        }),
      );

      const manifestBuf = await bodyToBuffer(manifestRes.Body);
      const parsed = parseArtifactManifest(
        artifactId,
        this.publicBaseUrl,
        JSON.parse(manifestBuf.toString("utf8")) as unknown,
      );

      const dataRes = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: parsed.blob_key,
        }),
      );
      const bodyBuf = await bodyToBuffer(dataRes.Body);
      return { ref: parsed.ref, body: bodyBuf };
    } catch (err) {
      if (isNoSuchKey(err)) return null;
      throw err;
    }
  }

  async delete(artifactId: string): Promise<void> {
    await this.ensureBucketOnce();

    const manifestKey = this.manifestKeyFor(artifactId);
    const keys = new Set<string>([manifestKey]);

    // Best-effort: include the blob key if we can read the manifest.
    try {
      const manifestRes = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: manifestKey,
        }),
      );

      const manifestBuf = await bodyToBuffer(manifestRes.Body);
      const candidate = JSON.parse(manifestBuf.toString("utf8")) as unknown;
      const maybe = candidate as Partial<ArtifactManifestV1> | null;
      if (maybe && maybe.v === 1 && typeof maybe.blob_key === "string") {
        keys.add(maybe.blob_key);
      }
    } catch (err) {
      if (!isNoSuchKey(err)) throw err;
    }

    for (const key of keys) {
      try {
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
          }),
        );
      } catch (err) {
        if (!isNoSuchKey(err)) throw err;
      }
    }
  }
}
