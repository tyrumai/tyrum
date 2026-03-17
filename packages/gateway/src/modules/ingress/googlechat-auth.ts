import { OAuth2Client } from "google-auth-library";
import type { GoogleChatAudienceType } from "../channels/channel-config-dal.js";

const CHAT_ISSUER = "chat@system.gserviceaccount.com";
const ADDON_ISSUER_PATTERN = /^service-\d+@gcp-sa-gsuiteaddons\.iam\.gserviceaccount\.com$/;
const CHAT_CERTS_URL =
  "https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com";

const verifyClient = new OAuth2Client();

let cachedCerts: { fetchedAt: number; certs: Record<string, string> } | null = null;

async function fetchChatCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedCerts && now - cachedCerts.fetchedAt < 10 * 60 * 1000) {
    return cachedCerts.certs;
  }
  const res = await fetch(CHAT_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Google Chat certs (${res.status})`);
  }
  const certs = (await res.json()) as Record<string, string>;
  cachedCerts = { fetchedAt: now, certs };
  return certs;
}

export async function verifyGoogleChatRequest(params: {
  bearer?: string | null;
  audienceType?: GoogleChatAudienceType | null;
  audience?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const bearer = params.bearer?.trim();
  if (!bearer) {
    return { ok: false, reason: "missing token" };
  }
  const audience = params.audience?.trim();
  if (!audience) {
    return { ok: false, reason: "missing audience" };
  }

  if (params.audienceType === "app-url") {
    try {
      const ticket = await verifyClient.verifyIdToken({
        idToken: bearer,
        audience,
      });
      const payload = ticket.getPayload();
      const email = String(payload?.email ?? "")
        .trim()
        .toLowerCase();
      if (!payload?.email_verified) {
        return { ok: false, reason: "email not verified" };
      }
      if (email === CHAT_ISSUER) {
        return { ok: true };
      }
      if (!ADDON_ISSUER_PATTERN.test(email)) {
        return { ok: false, reason: `invalid issuer: ${email}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "invalid token" };
    }
  }

  if (params.audienceType === "project-number") {
    try {
      const certs = await fetchChatCerts();
      await verifyClient.verifySignedJwtWithCertsAsync(bearer, certs, audience, [CHAT_ISSUER]);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "invalid token" };
    }
  }

  return { ok: false, reason: "unsupported audience type" };
}
