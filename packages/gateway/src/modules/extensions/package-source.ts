import { Buffer } from "node:buffer";
import { lookup } from "node:dns/promises";
import { basename } from "node:path";
import { BlockList, isIP } from "node:net";
import {
  buildManagedMcpPackageFromFiles,
  buildManagedSkillPackageFromFiles,
  buildManagedSkillPackageFromMarkdown,
} from "./managed.js";
import { extractZipArchive, isZipArchive } from "./archive.js";

const FORBIDDEN_OUTBOUND_IPS = new BlockList();
FORBIDDEN_OUTBOUND_IPS.addAddress("0.0.0.0");
FORBIDDEN_OUTBOUND_IPS.addSubnet("10.0.0.0", 8, "ipv4");
FORBIDDEN_OUTBOUND_IPS.addSubnet("100.64.0.0", 10, "ipv4");
FORBIDDEN_OUTBOUND_IPS.addSubnet("127.0.0.0", 8, "ipv4");
FORBIDDEN_OUTBOUND_IPS.addSubnet("169.254.0.0", 16, "ipv4");
FORBIDDEN_OUTBOUND_IPS.addSubnet("172.16.0.0", 12, "ipv4");
FORBIDDEN_OUTBOUND_IPS.addSubnet("192.168.0.0", 16, "ipv4");
FORBIDDEN_OUTBOUND_IPS.addSubnet("198.18.0.0", 15, "ipv4");
FORBIDDEN_OUTBOUND_IPS.addSubnet("224.0.0.0", 4, "ipv4");
FORBIDDEN_OUTBOUND_IPS.addAddress("::", "ipv6");
FORBIDDEN_OUTBOUND_IPS.addAddress("::1", "ipv6");
FORBIDDEN_OUTBOUND_IPS.addSubnet("fc00::", 7, "ipv6");
FORBIDDEN_OUTBOUND_IPS.addSubnet("fe80::", 10, "ipv6");
FORBIDDEN_OUTBOUND_IPS.addSubnet("ff00::", 8, "ipv6");

const FORBIDDEN_HOSTNAMES = new Set(["localhost", "localhost.localdomain"]);
const MAX_ARTIFACT_REDIRECTS = 5;

export class UnsafeExtensionUrlError extends Error {}

function decodeText(buffer: Buffer): string {
  return buffer.toString("utf-8").replace(/^\uFEFF/u, "");
}

function inferFilenameFromHeaders(response: Response, url: string): string | undefined {
  const contentDisposition = response.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/iu.exec(contentDisposition);
  if (match?.[1]) return basename(match[1].trim());
  try {
    return basename(new URL(url).pathname) || undefined;
  } catch (error) {
    void error;
    return undefined;
  }
}

async function assertSafeArtifactUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    void error;
    throw new UnsafeExtensionUrlError("artifact URL must be an absolute http(s) URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeExtensionUrlError("artifact URL must use http or https");
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeExtensionUrlError("artifact URL must not include credentials");
  }

  const hostname = parsed.hostname.trim().toLowerCase();
  if (!hostname || FORBIDDEN_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new UnsafeExtensionUrlError("artifact URL must not target localhost");
  }

  const literalIpFamily = isIP(hostname);
  if (literalIpFamily > 0) {
    const family = literalIpFamily === 6 ? "ipv6" : "ipv4";
    if (FORBIDDEN_OUTBOUND_IPS.check(hostname, family)) {
      throw new UnsafeExtensionUrlError("artifact URL resolves to a private or loopback address");
    }
    return parsed;
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new UnsafeExtensionUrlError("artifact URL hostname did not resolve");
  }
  for (const address of addresses) {
    const family = address.family === 6 ? "ipv6" : "ipv4";
    if (FORBIDDEN_OUTBOUND_IPS.check(address.address, family)) {
      throw new UnsafeExtensionUrlError("artifact URL resolves to a private or loopback address");
    }
  }
  return parsed;
}

export async function downloadArtifact(url: string): Promise<{
  body: Buffer;
  filename?: string;
  contentType?: string;
}> {
  let nextUrl = url;
  for (let redirects = 0; redirects <= MAX_ARTIFACT_REDIRECTS; redirects += 1) {
    const parsed = await assertSafeArtifactUrl(nextUrl);
    const response = await fetch(parsed, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(
          `download redirected without a location header (HTTP ${String(response.status)})`,
        );
      }
      nextUrl = new URL(location, parsed).toString();
      continue;
    }
    if (!response.ok) {
      throw new Error(`download failed with HTTP ${String(response.status)}`);
    }
    const body = Buffer.from(await response.arrayBuffer());
    return {
      body,
      filename: inferFilenameFromHeaders(response, parsed.toString()),
      contentType: response.headers.get("content-type") ?? undefined,
    };
  }
  throw new UnsafeExtensionUrlError("artifact URL exceeded the redirect limit");
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
  } catch (error) {
    void error;
    throw new Error("invalid base64 upload payload");
  }
}
