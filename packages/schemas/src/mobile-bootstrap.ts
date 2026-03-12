import { z } from "zod";

const MOBILE_BOOTSTRAP_VERSION = 1;
const MOBILE_BOOTSTRAP_SCHEME = "tyrum";
const MOBILE_BOOTSTRAP_HOST = "bootstrap";
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

function isUrlWithProtocols(value: string, protocols: readonly string[]): boolean {
  try {
    const url = new URL(value);
    return protocols.includes(url.protocol);
  } catch {
    return false;
  }
}

function encodeBase64UrlUtf8(value: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf-8").toString("base64url");
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64UrlUtf8(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf-8");
  }

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

export const MobileBootstrapHttpBaseUrl = z
  .string()
  .trim()
  .min(1)
  .refine((value) => isUrlWithProtocols(value, ["http:", "https:"]), {
    message: "Expected an http:// or https:// URL.",
  });

export const MobileBootstrapWsUrl = z
  .string()
  .trim()
  .min(1)
  .refine((value) => isUrlWithProtocols(value, ["ws:", "wss:"]), {
    message: "Expected a ws:// or wss:// URL.",
  });

export const MobileBootstrapToken = z.string().trim().min(1);

export function normalizeGatewayHttpBaseUrl(httpBaseUrl: string): string {
  return trimTrailingSlashes(httpBaseUrl.trim());
}

export function inferGatewayWsUrl(httpBaseUrl: string): string {
  const normalized = normalizeGatewayHttpBaseUrl(httpBaseUrl);
  if (normalized.startsWith("https://")) {
    return `${normalized.replace(/^https:\/\//, "wss://")}/ws`;
  }
  if (normalized.startsWith("http://")) {
    return `${normalized.replace(/^http:\/\//, "ws://")}/ws`;
  }
  return normalized;
}

export const MobileBootstrapPayload = z
  .object({
    v: z.literal(MOBILE_BOOTSTRAP_VERSION),
    httpBaseUrl: MobileBootstrapHttpBaseUrl,
    wsUrl: MobileBootstrapWsUrl,
    token: MobileBootstrapToken,
  })
  .strict();
export type MobileBootstrapPayload = z.infer<typeof MobileBootstrapPayload>;

export function createMobileBootstrapUrl(payload: MobileBootstrapPayload): string {
  const parsed = MobileBootstrapPayload.parse(payload);
  const url = new URL(`${MOBILE_BOOTSTRAP_SCHEME}://${MOBILE_BOOTSTRAP_HOST}`);
  url.searchParams.set("payload", encodeBase64UrlUtf8(JSON.stringify(parsed)));
  return url.toString();
}

export function parseMobileBootstrapUrl(url: string): MobileBootstrapPayload {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("Invalid bootstrap URL.");
  }

  if (parsedUrl.protocol.toLowerCase() !== `${MOBILE_BOOTSTRAP_SCHEME}:`) {
    throw new Error(`Expected ${MOBILE_BOOTSTRAP_SCHEME}:// URL.`);
  }

  if (parsedUrl.hostname.toLowerCase() !== MOBILE_BOOTSTRAP_HOST) {
    throw new Error(`Expected ${MOBILE_BOOTSTRAP_SCHEME}://${MOBILE_BOOTSTRAP_HOST}.`);
  }

  const encodedPayload = parsedUrl.searchParams.get("payload")?.trim() ?? "";
  if (encodedPayload.length === 0) {
    throw new Error("Bootstrap URL is missing the payload parameter.");
  }
  if (!BASE64URL_PATTERN.test(encodedPayload)) {
    throw new Error("Bootstrap URL payload is not valid base64url.");
  }

  let decodedPayload = "";
  try {
    decodedPayload = decodeBase64UrlUtf8(encodedPayload);
  } catch {
    throw new Error("Bootstrap URL payload is not valid base64url.");
  }

  let json: unknown;
  try {
    json = JSON.parse(decodedPayload) as unknown;
  } catch {
    throw new Error("Bootstrap URL payload is not valid JSON.");
  }

  const parsedPayload = MobileBootstrapPayload.safeParse(json);
  if (!parsedPayload.success) {
    throw new Error(parsedPayload.error.issues.at(0)?.message ?? "Invalid bootstrap payload.");
  }

  return parsedPayload.data;
}
