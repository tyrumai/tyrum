import { randomUUID } from "node:crypto";
import type { AuthProfile as AuthProfileT, AuthProfileCreateRequest as AuthProfileCreateRequestT, SecretHandle as SecretHandleT } from "@tyrum/schemas";
import { AuthProfileCreateRequest } from "@tyrum/schemas";
import type { SqlDb } from "../../statestore/types.js";
import type { Logger } from "../observability/logger.js";
import type { SecretProvider } from "../secret/provider.js";
import { EnvSecretProvider } from "../secret/provider.js";
import { AuthProfileDal } from "./dal.js";

function isActiveProfile(profile: AuthProfileT, now: number): boolean {
  if (profile.disabled_at) return false;
  if (profile.cooldown_until) {
    const ts = Date.parse(profile.cooldown_until);
    if (!isNaN(ts) && ts > now) return false;
  }
  return true;
}

function shouldRefreshOAuth(profile: AuthProfileT, nowMs: number): boolean {
  if (profile.type !== "oauth") return false;
  if (!profile.expires_at) return false;
  const expMs = Date.parse(profile.expires_at);
  if (isNaN(expMs)) return false;
  return expMs <= nowMs + 60_000;
}

function normalizeIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export class AuthProfileService {
  private readonly dal: AuthProfileDal;
  private readonly lockOwner: string;

  constructor(
    db: SqlDb,
    private readonly secretProvider: SecretProvider,
    private readonly logger?: Logger,
  ) {
    this.lockOwner =
      process.env["GATEWAY_INSTANCE_ID"]?.trim() ||
      process.env["TYRUM_INSTANCE_ID"]?.trim() ||
      `pid-${String(process.pid)}`;
    this.dal = new AuthProfileDal(db);
    this.db = db;
  }

  private readonly db: SqlDb;

  async create(raw: unknown): Promise<AuthProfileT> {
    const parsed = AuthProfileCreateRequest.safeParse(raw);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    const req: AuthProfileCreateRequestT = parsed.data;
    const profileId = `auth-${randomUUID()}`;

    if (req.type === "api_key") {
      if (!(this.secretProvider instanceof EnvSecretProvider) && (!req.value || req.value.trim().length === 0)) {
        throw new Error("value is required for non-env secret providers");
      }
      const apiKeyHandle = await this.secretProvider.store(req.scope, req.value ?? "");
      return await this.dal.create({
        profileId,
        agentId: req.agent_id,
        provider: req.provider,
        type: "api_key",
        secretHandles: { api_key: apiKeyHandle },
        labels: req.labels,
      });
    }

    if (req.type === "token") {
      if (!(this.secretProvider instanceof EnvSecretProvider) && (!req.value || req.value.trim().length === 0)) {
        throw new Error("value is required for non-env secret providers");
      }
      const tokenHandle = await this.secretProvider.store(req.scope, req.value ?? "");
      return await this.dal.create({
        profileId,
        agentId: req.agent_id,
        provider: req.provider,
        type: "token",
        secretHandles: { token: tokenHandle },
        expiresAt: req.expires_at,
        labels: req.labels,
      });
    }

    // oauth
    if (this.secretProvider instanceof EnvSecretProvider) {
      throw new Error("oauth profiles are not supported with env secret providers");
    }

    const accessHandle = await this.secretProvider.store(
      `${req.provider}_access_token_${profileId}`,
      req.access_token,
    );
    const refreshHandle = await this.secretProvider.store(
      `${req.provider}_refresh_token_${profileId}`,
      req.refresh_token,
    );

    let clientSecretHandle: SecretHandleT | undefined;
    if (req.client_secret_scope && req.client_secret_value) {
      clientSecretHandle = await this.secretProvider.store(req.client_secret_scope, req.client_secret_value);
    } else if (req.client_secret_scope || req.client_secret_value) {
      throw new Error("client_secret_scope and client_secret_value must be provided together");
    }

    return await this.dal.create({
      profileId,
      agentId: req.agent_id,
      provider: req.provider,
      type: "oauth",
      oauth: { token_url: req.token_url, client_id: req.client_id },
      secretHandles: {
        access_token: accessHandle,
        refresh_token: refreshHandle,
        ...(clientSecretHandle ? { client_secret: clientSecretHandle } : {}),
      },
      expiresAt: req.expires_at,
      labels: req.labels,
    });
  }

  async list(filter?: { agentId?: string; provider?: string }): Promise<AuthProfileT[]> {
    return await this.dal.list(filter);
  }

  async delete(profileId: string, opts?: { revokeSecrets?: boolean }): Promise<AuthProfileT | undefined> {
    const existing = await this.dal.delete(profileId);
    if (!existing) return undefined;

    if (opts?.revokeSecrets) {
      const handles = Object.values(existing.secret_handles ?? {});
      for (const handle of handles) {
        void this.secretProvider.revoke(handle.handle_id).catch(() => false);
      }
    }

    return existing;
  }

  async resolveBearerToken(opts: {
    agentId: string;
    provider: string;
    sessionId: string;
  }): Promise<{ profileId: string; token: string } | undefined> {
    const nowMs = Date.now();

    const pinnedId = await this.dal.getPinnedProfileId(opts.agentId, opts.sessionId, opts.provider);
    if (pinnedId) {
      const pinned = await this.dal.getById(pinnedId);
      if (pinned && pinned.agent_id === opts.agentId && isActiveProfile(pinned, nowMs)) {
        const token = await this.resolveTokenForProfile(pinned);
        if (token) {
          return { profileId: pinned.profile_id, token };
        }
      }
      await this.dal.clearPinnedProfileId(opts.agentId, opts.sessionId, opts.provider);
    }

    const candidates = await this.dal.list({ agentId: opts.agentId, provider: opts.provider });
    for (const profile of candidates) {
      if (!isActiveProfile(profile, nowMs)) continue;
      const token = await this.resolveTokenForProfile(profile);
      if (!token) continue;

      await this.dal.setPinnedProfileId(opts.agentId, opts.sessionId, opts.provider, profile.profile_id);
      this.logger?.info("auth_profile.pinned", {
        agent_id: opts.agentId,
        session_id: opts.sessionId,
        provider: opts.provider,
        profile_id: profile.profile_id,
      });
      return { profileId: profile.profile_id, token };
    }

    return undefined;
  }

  async rotateBearerToken(opts: {
    agentId: string;
    provider: string;
    sessionId: string;
    failedProfileId: string;
    failure: "rate_limit" | "transient" | "auth" | "quota";
  }): Promise<{ profileId: string; token: string } | undefined> {
    const nowMs = Date.now();

    switch (opts.failure) {
      case "auth":
        await this.dal.disable(opts.failedProfileId, "auth_failed");
        break;
      case "quota":
        await this.dal.disable(opts.failedProfileId, "quota_exhausted");
        break;
      case "rate_limit":
      case "transient": {
        const cooldownMs = opts.failure === "rate_limit" ? 60_000 : 30_000;
        const untilIso = new Date(nowMs + cooldownMs).toISOString();
        await this.dal.setCooldown(opts.failedProfileId, untilIso);
        break;
      }
      default:
        break;
    }

    const pinnedId = await this.dal.getPinnedProfileId(opts.agentId, opts.sessionId, opts.provider);
    if (pinnedId === opts.failedProfileId) {
      await this.dal.clearPinnedProfileId(opts.agentId, opts.sessionId, opts.provider);
    }

    const candidates = await this.dal.list({ agentId: opts.agentId, provider: opts.provider });
    for (const profile of candidates) {
      if (profile.profile_id === opts.failedProfileId) continue;
      if (!isActiveProfile(profile, nowMs)) continue;
      const token = await this.resolveTokenForProfile(profile);
      if (!token) continue;

      await this.dal.setPinnedProfileId(opts.agentId, opts.sessionId, opts.provider, profile.profile_id);
      this.logger?.info("auth_profile.rotated", {
        agent_id: opts.agentId,
        session_id: opts.sessionId,
        provider: opts.provider,
        profile_id: profile.profile_id,
        failure: opts.failure,
      });

      return { profileId: profile.profile_id, token };
    }

    return undefined;
  }

  private async resolveTokenForProfile(profile: AuthProfileT): Promise<string | null> {
    if (profile.type === "api_key") {
      return await this.secretProvider.resolve(profile.secret_handles.api_key);
    }
    if (profile.type === "token") {
      return await this.secretProvider.resolve(profile.secret_handles.token);
    }
    if (shouldRefreshOAuth(profile, Date.now())) {
      await this.refreshOAuthProfile(profile.profile_id).catch(() => undefined);
      const updated = await this.dal.getById(profile.profile_id);
      if (updated && updated.type === "oauth") {
        return await this.secretProvider.resolve(updated.secret_handles.access_token);
      }
    }
    return await this.secretProvider.resolve(profile.secret_handles.access_token);
  }

  async refreshOAuthProfile(profileId: string): Promise<void> {
    const profile = await this.dal.getById(profileId);
    if (!profile || profile.type !== "oauth") {
      throw new Error("oauth profile not found");
    }
    if (this.secretProvider instanceof EnvSecretProvider) {
      throw new Error("oauth refresh not supported with env secret providers");
    }

    const nowMs = Date.now();
    if (!shouldRefreshOAuth(profile, nowMs)) {
      return;
    }

    const acquired = await this.tryAcquireRefreshLock(profile.profile_id, nowMs, 30_000);
    if (!acquired) {
      // Another worker is refreshing; wait briefly for it to complete.
      for (let i = 0; i < 10; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        const updated = await this.dal.getById(profile.profile_id);
        if (updated && updated.type === "oauth" && !shouldRefreshOAuth(updated, Date.now())) {
          return;
        }
      }
      return;
    }

    try {
      const latest = await this.dal.getById(profile.profile_id);
      if (!latest || latest.type !== "oauth") {
        return;
      }
      if (!shouldRefreshOAuth(latest, Date.now())) {
        return;
      }

      const refreshToken = await this.secretProvider.resolve(latest.secret_handles.refresh_token);
      if (!refreshToken) {
        throw new Error("refresh token not available");
      }

      const clientSecret = latest.secret_handles.client_secret
        ? await this.secretProvider.resolve(latest.secret_handles.client_secret)
        : null;

      const body = new URLSearchParams();
      body.set("grant_type", "refresh_token");
      body.set("refresh_token", refreshToken);
      body.set("client_id", latest.oauth.client_id);
      if (clientSecret) {
        body.set("client_secret", clientSecret);
      }

      const res = await fetch(latest.oauth.token_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`token refresh failed (${res.status}): ${text}`);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        throw new Error("token refresh returned non-JSON response");
      }

      if (!parsed || typeof parsed !== "object") {
        throw new Error("token refresh returned invalid JSON");
      }

      const record = parsed as Record<string, unknown>;
      const accessToken = typeof record["access_token"] === "string" ? record["access_token"] : undefined;
      const newRefreshToken = typeof record["refresh_token"] === "string" ? record["refresh_token"] : undefined;
      const expiresIn = typeof record["expires_in"] === "number" ? record["expires_in"] : undefined;
      if (!accessToken) {
        throw new Error("token refresh response missing access_token");
      }

      const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : latest.expires_at;

      const newAccessHandle = await this.secretProvider.store(latest.secret_handles.access_token.scope, accessToken);
      const newRefreshHandle = newRefreshToken
        ? await this.secretProvider.store(latest.secret_handles.refresh_token.scope, newRefreshToken)
        : latest.secret_handles.refresh_token;

      const updatedHandles = {
        ...latest.secret_handles,
        access_token: newAccessHandle,
        refresh_token: newRefreshHandle,
      };

      await this.dal.updateTokens({
        profileId: latest.profile_id,
        secretHandles: updatedHandles,
        expiresAt: expiresAt ?? undefined,
      });

      void this.secretProvider.revoke(latest.secret_handles.access_token.handle_id).catch(() => false);
      if (newRefreshToken) {
        void this.secretProvider.revoke(latest.secret_handles.refresh_token.handle_id).catch(() => false);
      }

      this.logger?.info("auth_profile.oauth_refreshed", {
        profile_id: latest.profile_id,
        provider: latest.provider,
        expires_at: expiresAt ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger?.error("auth_profile.oauth_refresh_failed", {
        profile_id: profile.profile_id,
        provider: profile.provider,
        error: message,
      });
      throw err;
    } finally {
      await this.releaseRefreshLock(profile.profile_id);
    }
  }

  private async tryAcquireRefreshLock(profileId: string, nowMs: number, ttlMs: number): Promise<boolean> {
    const nowIso = new Date(nowMs).toISOString();
    const lockedUntilIso = new Date(nowMs + ttlMs).toISOString();

    return await this.db.transaction(async (tx) => {
      const row = await tx.get<{ locked_by: string; locked_until: string | Date }>(
        "SELECT locked_by, locked_until FROM auth_profile_refresh_locks WHERE profile_id = ?",
        [profileId],
      );

      if (!row) {
        await tx.run(
          `INSERT INTO auth_profile_refresh_locks (profile_id, locked_by, locked_until, updated_at)
           VALUES (?, ?, ?, ?)`,
          [profileId, this.lockOwner, lockedUntilIso, nowIso],
        );
        return true;
      }

      const lockedUntil = Date.parse(normalizeIso(row.locked_until));
      const isExpired = isNaN(lockedUntil) || lockedUntil <= nowMs;
      const owned = row.locked_by === this.lockOwner;
      if (!isExpired && !owned) {
        return false;
      }

      await tx.run(
        `UPDATE auth_profile_refresh_locks
         SET locked_by = ?, locked_until = ?, updated_at = ?
         WHERE profile_id = ?`,
        [this.lockOwner, lockedUntilIso, nowIso, profileId],
      );
      return true;
    });
  }

  private async releaseRefreshLock(profileId: string): Promise<void> {
    await this.db.run(
      "DELETE FROM auth_profile_refresh_locks WHERE profile_id = ? AND locked_by = ?",
      [profileId, this.lockOwner],
    );
  }

  static defaultAgentId(): string {
    return process.env["TYRUM_AGENT_ID"]?.trim() || "default";
  }

  static readSessionHeader(headers: Headers): string | undefined {
    const session = headers.get("x-tyrum-session-id")?.trim();
    return session && session.length > 0 ? session : undefined;
  }

  static readAgentHeader(headers: Headers): string | undefined {
    const agent = headers.get("x-tyrum-agent-id")?.trim();
    return agent && agent.length > 0 ? agent : undefined;
  }

  static effectiveAgentId(headers: Headers): string {
    return AuthProfileService.readAgentHeader(headers) ?? AuthProfileService.defaultAgentId();
  }
}
