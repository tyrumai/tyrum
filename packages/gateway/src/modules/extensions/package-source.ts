import { Buffer } from "node:buffer";
import { basename } from "node:path";
import {
  buildManagedMcpPackageFromFiles,
  buildManagedSkillPackageFromFiles,
  buildManagedSkillPackageFromMarkdown,
} from "./managed.js";
import { extractZipArchive, isZipArchive } from "./archive.js";

function decodeText(buffer: Buffer): string {
  return buffer.toString("utf-8").replace(/^\uFEFF/u, "");
}

function inferFilenameFromHeaders(response: Response, url: string): string | undefined {
  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/iu.exec(contentDisposition);
  if (match?.[1]) return basename(match[1].trim());
  try {
    return basename(new URL(url).pathname) || undefined;
  } catch {
    return undefined;
  }
}

export async function downloadArtifact(url: string): Promise<{
  body: Buffer;
  filename?: string;
  contentType?: string;
}> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed with HTTP ${String(response.status)}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  return {
    body,
    filename: inferFilenameFromHeaders(response, url),
    contentType: response.headers.get("content-type") ?? undefined,
  };
}

export async function buildSkillPackageFromArtifact(input: {
  key?: string;
  buffer: Buffer;
  filename?: string;
  contentType?: string;
  source: "direct-url" | "upload";
  url?: string;
}): Promise<ReturnType<typeof buildManagedSkillPackageFromMarkdown>> {
  if (isZipArchive(input.buffer)) {
    const files = await extractZipArchive(input.buffer);
    return buildManagedSkillPackageFromFiles({
      key: input.key,
      files,
      source:
        input.source === "direct-url"
          ? {
              kind: "direct-url",
              url: input.url ?? "",
              filename: input.filename,
              content_type: input.contentType,
            }
          : {
              kind: "upload",
              filename: input.filename,
              content_type: input.contentType,
            },
    });
  }

  return buildManagedSkillPackageFromMarkdown({
    key: input.key,
    markdown: decodeText(input.buffer),
    source:
      input.source === "direct-url"
        ? {
            kind: "direct-url",
            url: input.url ?? "",
            filename: input.filename,
            content_type: input.contentType,
          }
        : {
            kind: "upload",
            filename: input.filename,
            content_type: input.contentType,
          },
  });
}

export async function buildMcpPackageFromArchive(input: {
  key?: string;
  buffer: Buffer;
  filename?: string;
  contentType?: string;
  source: "direct-url" | "upload";
  url?: string;
}) {
  if (isZipArchive(input.buffer)) {
    const files = await extractZipArchive(input.buffer);
    return buildManagedMcpPackageFromFiles({
      key: input.key,
      files,
      source:
        input.source === "direct-url"
          ? {
              kind: "direct-url",
              url: input.url ?? "",
              mode: "archive",
              filename: input.filename,
              content_type: input.contentType,
            }
          : {
              kind: "upload",
              filename: input.filename,
              content_type: input.contentType,
            },
    });
  }

  return buildManagedMcpPackageFromFiles({
    key: input.key,
    files: [{ path: "server.yml", content: input.buffer }],
    source:
      input.source === "direct-url"
        ? {
            kind: "direct-url",
            url: input.url ?? "",
            mode: "archive",
            filename: input.filename,
            content_type: input.contentType,
          }
        : {
            kind: "upload",
            filename: input.filename,
            content_type: input.contentType,
          },
  });
}

export function decodeUploadedBuffer(contentBase64: string): Buffer {
  try {
    return Buffer.from(contentBase64, "base64");
  } catch {
    throw new Error("invalid base64 upload payload");
  }
}
