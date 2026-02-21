/**
 * Model proxy routes — port of services/model_gateway/src/main.rs.
 *
 * Loads a YAML config defining model routes and auth profiles,
 * then proxies requests to the appropriate upstream provider.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import type { SecretProvider } from "../modules/secret/provider.js";
import type { AuthProfileDal, AuthProfileRow } from "../modules/models/auth-profile-dal.js";
import type { SessionProviderPinDal } from "../modules/models/session-pin-dal.js";
import type { OutboxDal } from "../modules/backplane/outbox-dal.js";
import type { Logger } from "../modules/observability/logger.js";
import type { WsEventEnvelope } from "@tyrum/schemas";

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

interface AuthProfileConfig {
  type: "none" | "bearer" | "static_header";
  env?: string;
  header?: string;
  value?: string;
}

interface ModelConfig {
  target: string;
  endpoint: string;
  auth_profile?: string;
  capabilities?: string[];
  max_total_tokens?: number;
  cost_ceiling_usd?: number;
  fallback_models?: string[];
}

interface DefaultsConfig {
  timeout_ms?: number;
}

interface GatewayConfig {
  defaults?: DefaultsConfig;
  auth_profiles?: Record<string, AuthProfileConfig>;
  models?: Record<string, ModelConfig>;
}

// ---------------------------------------------------------------------------
// Resolved runtime types
// ---------------------------------------------------------------------------

type ResolvedAuth =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "static"; header: string; value: string };

interface ModelRoute {
  target: string;
  baseUrl: string;
  auth: ResolvedAuth;
  capabilities: string[];
  maxTotalTokens?: number;
  costCeilingUsd?: number;
  fallbackModels?: string[];
}

interface ModelGatewayState {
  routes: Map<string, ModelRoute>;
  timeoutMs: number;
}

export interface ModelProxyDeps {
  auth?: {
    authProfileDal: AuthProfileDal;
    pinDal: SessionProviderPinDal;
    secretProviderForAgent: (agentId: string) => Promise<SecretProvider>;
    logger?: Logger;
    wsCluster?: {
      edgeId: string;
      outboxDal: OutboxDal;
    };
  };
}

// ---------------------------------------------------------------------------
// Hop-by-hop headers to strip
// ---------------------------------------------------------------------------

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

const RESPONSE_SKIP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

function resolveAuth(profile: AuthProfileConfig): ResolvedAuth {
  switch (profile.type) {
    case "none":
      return { kind: "none" };
    case "bearer": {
      const envVar = profile.env;
      if (!envVar) throw new Error("bearer auth requires 'env' field");
      const token = process.env[envVar];
      if (!token?.trim()) {
        throw new Error(
          `environment variable '${envVar}' for bearer auth is empty or missing`,
        );
      }
      return { kind: "bearer", token: token.trim() };
    }
    case "static_header": {
      if (!profile.header || !profile.value) {
        throw new Error("static_header auth requires 'header' and 'value'");
      }
      return { kind: "static", header: profile.header, value: profile.value };
    }
    default:
      return { kind: "none" };
  }
}

function sanitizeBaseUrl(raw: string): string {
  const url = new URL(raw);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function loadModelGatewayConfig(configPath: string): ModelGatewayState {
  const contents = readFileSync(configPath, "utf-8");
  if (!contents.trim()) {
    throw new Error(
      `model gateway config at ${configPath} is empty; define at least one model route`,
    );
  }

  const config = parseYaml(contents) as GatewayConfig;
  const timeoutMs = config.defaults?.timeout_ms ?? 20_000;

  const resolvedProfiles = new Map<string, ResolvedAuth>();
  if (config.auth_profiles) {
    for (const [key, profile] of Object.entries(config.auth_profiles)) {
      resolvedProfiles.set(key, resolveAuth(profile));
    }
  }

  const routes = new Map<string, ModelRoute>();
  if (config.models) {
    for (const [modelName, cfg] of Object.entries(config.models)) {
      const baseUrl = sanitizeBaseUrl(cfg.endpoint);
      const auth = cfg.auth_profile
        ? resolvedProfiles.get(cfg.auth_profile) ?? { kind: "none" as const }
        : { kind: "none" as const };

      routes.set(modelName, {
        target: cfg.target,
        baseUrl,
        auth,
        capabilities: cfg.capabilities ?? [],
        maxTotalTokens: cfg.max_total_tokens,
        costCeilingUsd: cfg.cost_ceiling_usd,
        fallbackModels: cfg.fallback_models,
      });
    }
  }

  if (routes.size === 0) {
    throw new Error(
      `model gateway config at ${configPath} defines no models; at least one is required`,
    );
  }

  return { routes, timeoutMs };
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createModelProxyRoutes(configPath: string, deps?: ModelProxyDeps): Hono {
  const state = loadModelGatewayConfig(configPath);
  return createModelProxyRoutesFromState(state, deps);
}

export function createModelProxyRoutesFromState(
  state: ModelGatewayState,
  deps?: ModelProxyDeps,
): Hono {
  const proxy = new Hono();

  function isAuthProfilesEnabled(): boolean {
    const raw = process.env["TYRUM_AUTH_PROFILES_ENABLED"]?.trim().toLowerCase();
    return Boolean(raw && !["0", "false", "off", "no"].includes(raw));
  }

  function emitEvent(evt: WsEventEnvelope): void {
    const ws = deps?.auth?.wsCluster;
    if (!ws) return;
    void ws.outboxDal.enqueue("ws.broadcast", {
      source_edge_id: ws.edgeId,
      skip_local: false,
      message: evt,
    }).catch(() => {
      // ignore
    });
  }

  async function resolveSecretHandleValue(agentId: string, handleId: string): Promise<string | null> {
    const resolver = deps?.auth?.secretProviderForAgent;
    if (!resolver) return null;
    const provider = await resolver(agentId);
    const handles = await provider.list();
    const handle = handles.find((h) => h.handle_id === handleId);
    if (!handle) return null;
    return await provider.resolve(handle);
  }

  function isTransientStatus(status: number): boolean {
    return status === 429 || status === 502 || status === 503 || status === 504 || status >= 500;
  }

  function isAuthInvalidStatus(status: number): boolean {
    return status === 401 || status === 403;
  }

  // Health endpoint showing configured models
  proxy.get("/v1/models", (c) => {
    const models = Array.from(state.routes.entries()).map(
      ([name, route]) => ({
        model: name,
        target: route.target,
        endpoint: route.baseUrl,
        capabilities: route.capabilities,
        max_total_tokens: route.maxTotalTokens,
        cost_ceiling_usd: route.costCeilingUsd,
      }),
    );
    return c.json({
      status: "ok",
      timeout_ms: state.timeoutMs,
      models,
    });
  });

  // Proxy handler for all OpenAI-compatible endpoints
  const proxyHandler = async (c: Context) => {
    const bodyBytes = await c.req.arrayBuffer();
    const bodyText = new TextDecoder().decode(bodyBytes);

    let parsed: { model?: string; stream?: boolean };
    try {
      parsed = JSON.parse(bodyText) as { model?: string; stream?: boolean };
    } catch {
      return c.json({ error: "invalid JSON payload" }, 400);
    }

    const modelName = parsed.model;
    if (!modelName || typeof modelName !== "string") {
      return c.json(
        { error: "request body missing 'model' field" },
        400,
      );
    }

    const route = state.routes.get(modelName);
    if (!route) {
      return c.json(
        { error: `model '${modelName}' is not configured` },
        404,
      );
    }

    // Build upstream URL using the original path
    const originalPath = new URL(c.req.url).pathname;
    const upstreamUrl = route.baseUrl.replace(/\/$/, "") + originalPath;

    const baseForwardHeaders = new Headers();
    for (const [name, value] of Object.entries(c.req.header())) {
      if (typeof value !== "string") continue;
      const lower = name.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(lower)) continue;
      // Skip authorization — we'll apply route-specific auth.
      if (lower === "authorization") continue;
      // Never forward internal metadata headers to upstream providers.
      if (lower.startsWith("x-tyrum-")) continue;

      baseForwardHeaders.set(name, value);
    }
    baseForwardHeaders.set("Content-Type", "application/json");

    const agentId = c.req.header("x-tyrum-agent-id")?.trim() || "default";
    const sessionId = c.req.header("x-tyrum-session-id")?.trim() || undefined;

    async function attemptWithProfile(profile: AuthProfileRow): Promise<Response | undefined> {
      const secretHandles = profile.secret_handles ?? {};
      const handleId =
        profile.type === "api_key"
          ? secretHandles["api_key_handle"]
          : profile.type === "token"
            ? secretHandles["token_handle"]
            : secretHandles["access_token_handle"];
      if (!handleId) return undefined;

      const token = await resolveSecretHandleValue(agentId, handleId);
      if (!token) {
        // Missing secret material; skip (operator may re-store).
        deps?.auth?.logger?.warn("model_proxy.auth_profile_secret_missing", {
          profile_id: profile.profile_id,
          provider: profile.provider,
        });
        return undefined;
      }

      const forwardHeaders = new Headers(baseForwardHeaders);
      forwardHeaders.set("Authorization", `Bearer ${token}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), state.timeoutMs);
      try {
        return await fetch(upstreamUrl, {
          method: "POST",
          headers: forwardHeaders,
          body: new Uint8Array(bodyBytes),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    async function attemptWithLegacyAuth(targetRoute: ModelRoute): Promise<Response> {
      const forwardHeaders = new Headers(baseForwardHeaders);

      // Apply route auth (legacy YAML config)
      switch (targetRoute.auth.kind) {
        case "bearer":
          forwardHeaders.set("Authorization", `Bearer ${targetRoute.auth.token}`);
          break;
        case "static":
          forwardHeaders.set(targetRoute.auth.header, targetRoute.auth.value);
          break;
        case "none":
          break;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), state.timeoutMs);
      try {
        return await fetch(upstreamUrl, {
          method: "POST",
          headers: forwardHeaders,
          body: new Uint8Array(bodyBytes),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    let upstreamResponse: Response | undefined;
    let usedProfileId: string | undefined;

    if (deps?.auth && isAuthProfilesEnabled()) {
      const nowMs = Date.now();
      const eligible = await deps.auth.authProfileDal.listEligibleForProvider({
        agentId,
        provider: route.target,
        nowMs,
      });

      let pinnedId: string | undefined;
      if (sessionId) {
        const pin = await deps.auth.pinDal.get({ agentId, sessionId, provider: route.target });
        pinnedId = pin?.profile_id;
      }

      const ordered = pinnedId
        ? [...eligible].sort((a, b) => (a.profile_id === pinnedId ? -1 : b.profile_id === pinnedId ? 1 : 0))
        : eligible;

      let lastErr: unknown;
      for (const profile of ordered) {
        let res: Response | undefined;
        try {
          res = await attemptWithProfile(profile);
        } catch (err) {
          lastErr = err;
          const cooldownMs = 30_000;
          await deps.auth.authProfileDal.setCooldown(profile.profile_id, { untilMs: nowMs + cooldownMs });
          emitEvent({
            event_id: randomUUID(),
            type: "model.auth_profile.cooldown",
            occurred_at: new Date().toISOString(),
            payload: { provider: route.target, profile_id: profile.profile_id, cooldown_ms: cooldownMs },
          });
          continue;
        }

        if (!res) continue;
        if (res.ok) {
          upstreamResponse = res;
          usedProfileId = profile.profile_id;
          break;
        }

        if (isAuthInvalidStatus(res.status)) {
          await deps.auth.authProfileDal.disableProfile(profile.profile_id, { reason: `upstream_auth_${String(res.status)}` });
          emitEvent({
            event_id: randomUUID(),
            type: "model.auth_profile.disabled",
            occurred_at: new Date().toISOString(),
            payload: { provider: route.target, profile_id: profile.profile_id, status: res.status },
          });
          continue;
        }

        if (isTransientStatus(res.status)) {
          const cooldownMs = res.status === 429 ? 60_000 : 15_000;
          await deps.auth.authProfileDal.setCooldown(profile.profile_id, { untilMs: nowMs + cooldownMs });
          emitEvent({
            event_id: randomUUID(),
            type: "model.auth_profile.cooldown",
            occurred_at: new Date().toISOString(),
            payload: { provider: route.target, profile_id: profile.profile_id, status: res.status, cooldown_ms: cooldownMs },
          });
          continue;
        }

        upstreamResponse = res;
        usedProfileId = profile.profile_id;
        break;
      }

      if (!upstreamResponse) {
        // All profiles failed or none available; fall back to legacy config.
        try {
          upstreamResponse = await attemptWithLegacyAuth(route);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return c.json(
            { error: `upstream request failed for model '${modelName}': ${message}` },
            502,
          );
        }
        if (lastErr) {
          deps.auth.logger?.warn("model_proxy.auth_profiles_failed", {
            provider: route.target,
            model: modelName,
            error: lastErr instanceof Error ? lastErr.message : String(lastErr),
          });
        }
      }
    } else {
      // Legacy auth-only path.
      try {
        upstreamResponse = await attemptWithLegacyAuth(route);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return c.json(
          { error: `upstream request failed for model '${modelName}': ${message}` },
          502,
        );
      }
    }

    if (!upstreamResponse) {
      return c.json(
        { error: `upstream request failed for model '${modelName}': no response` },
        502,
      );
    }

    if (deps?.auth && isAuthProfilesEnabled() && sessionId && usedProfileId && upstreamResponse.ok) {
      try {
        const pin = await deps.auth.pinDal.upsert({
          agentId,
          sessionId,
          provider: route.target,
          profileId: usedProfileId,
        });
        emitEvent({
          event_id: randomUUID(),
          type: "model.auth_profile.pinned",
          occurred_at: new Date().toISOString(),
          payload: { provider: route.target, model: modelName, pin },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.auth.logger?.warn("model_proxy.pin_failed", { provider: route.target, model: modelName, error: message });
      }
    }

    // Determine if streaming
    const isStream =
      parsed.stream === true ||
      upstreamResponse.headers
        .get("content-type")
        ?.startsWith("text/event-stream") === true;

    // Build response headers (filter hop-by-hop)
    const responseHeaders = new Headers();
    upstreamResponse.headers.forEach((value, name) => {
      if (!RESPONSE_SKIP_HEADERS.has(name.toLowerCase())) {
        responseHeaders.set(name, value);
      }
    });

    if (isStream && upstreamResponse.body) {
      // Stream the response through
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: responseHeaders,
      });
    }

    // Buffered response
    const responseBytes = await upstreamResponse.arrayBuffer();
    return new Response(new Uint8Array(responseBytes), {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  };

  proxy.post("/v1/completions", proxyHandler);
  proxy.post("/v1/chat/completions", proxyHandler);
  proxy.post("/v1/embeddings", proxyHandler);
  proxy.post("/v1/audio/speech", proxyHandler);

  return proxy;
}
