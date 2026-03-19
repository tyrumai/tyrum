import type { GoogleChatAudienceType } from "../channels/channel-config-model.js";

const CHAT_ISSUER = "chat@system.gserviceaccount.com";
const ADDON_ISSUER_PATTERN = /^service-\d+@gcp-sa-gsuiteaddons\.iam\.gserviceaccount\.com$/;
const CHAT_CERTS_URL =
  "https://www.googleapis.com/service_accounts/v1/metadata/x509/chat@system.gserviceaccount.com";

type GoogleAuthTicketPayload = {
  email?: string;
  email_verified?: boolean;
};

type GoogleAuthTicket = {
  getPayload(): GoogleAuthTicketPayload | undefined;
};

type GoogleOAuth2Client = {
  verifyIdToken(input: { idToken: string; audience: string }): Promise<GoogleAuthTicket>;
  verifySignedJwtWithCertsAsync(
    bearer: string,
    certs: Record<string, string>,
    audience: string,
    issuers: string[],
  ): Promise<unknown>;
};

let verifyClient: GoogleOAuth2Client | null = null;

async function getVerifyClient(): Promise<GoogleOAuth2Client> {
  if (verifyClient) {
    return verifyClient;
  }
  try {
    const client = await import("google-auth-library").then((module) => new module.OAuth2Client());
    verifyClient = client;
    return client;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`google-auth-library is required for Google Chat auth: ${detail}`);
  }
}

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
      const client = await getVerifyClient();
      const ticket = await client.verifyIdToken({
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
      const client = await getVerifyClient();
      const certs = await fetchChatCerts();
      await client.verifySignedJwtWithCertsAsync(bearer, certs, audience, [CHAT_ISSUER]);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "invalid token" };
    }
  }

  return { ok: false, reason: "unsupported audience type" };
}
