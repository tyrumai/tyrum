import { Buffer } from "node:buffer";
import { posix as pathPosix } from "node:path";
import * as yauzl from "yauzl";

export type ArchiveFile = {
  path: string;
  content: Buffer;
};

function sanitizeArchivePath(rawPath: string): string | undefined {
  const normalized = pathPosix.normalize(rawPath.replaceAll("\\", "/")).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.endsWith("/")) return undefined;
  if (normalized.split("/").some((segment) => segment === "..")) return undefined;
  return normalized;
}

function stripCommonTopLevelDir(files: readonly ArchiveFile[]): ArchiveFile[] {
  if (files.length === 0) return [];
  const firstSegments = new Set<string>();
  for (const file of files) {
    const [firstSegment] = file.path.split("/");
    if (!firstSegment || !file.path.includes("/")) return [...files];
    firstSegments.add(firstSegment);
  }
  if (firstSegments.size !== 1) return [...files];
  const [prefix] = [...firstSegments];
  if (!prefix) return [...files];
  return files.map((file) => ({
    path: file.path.slice(prefix.length + 1),
    content: file.content,
  }));
}

function openZip(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true },
      (error: Error | null, zipFile: yauzl.ZipFile | undefined) => {
        if (error) {
          reject(error);
          return;
        }
        if (!zipFile) {
          reject(new Error("zip archive could not be opened"));
          return;
        }
        resolve(zipFile);
      },
    );
  });
}

function readZipEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(
      entry,
      (error: Error | null, stream: NodeJS.ReadableStream | undefined) => {
        if (error) {
          reject(error);
          return;
        }
        if (!stream) {
          reject(new Error(`zip entry '${entry.fileName}' could not be opened`));
          return;
        }
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer | Uint8Array) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        stream.on("error", reject);
        stream.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
      },
    );
  });
}

export function isZipArchive(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export async function extractZipArchive(buffer: Buffer): Promise<ArchiveFile[]> {
  const zipFile = await openZip(buffer);
  const files: ArchiveFile[] = [];

  await new Promise<void>((resolve, reject) => {
    zipFile.on("entry", async (entry: yauzl.Entry) => {
      try {
        const safePath = sanitizeArchivePath(entry.fileName);
        if (!safePath) {
          zipFile.readEntry();
          return;
        }
        const content = await readZipEntry(zipFile, entry);
        files.push({ path: safePath, content });
        zipFile.readEntry();
      } catch (error) {
        zipFile.close();
        reject(error);
      }
    });
    zipFile.once("end", () => resolve());
    zipFile.once("error", reject);
    zipFile.readEntry();
  });

  zipFile.close();
  return stripCommonTopLevelDir(files);
}
