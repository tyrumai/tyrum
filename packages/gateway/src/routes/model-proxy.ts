/**
 * Model proxy routes — port of services/model_gateway/src/main.rs.
 *
 * Loads a YAML config defining model routes and auth profiles,
 * then proxies requests to the appropriate upstream provider.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { AuthProfileService } from "../modules/auth-profiles/service.js";

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
  fallback_chain?: string[];
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
  fallbackChain: string[];
}

interface ModelGatewayState {
  routes: Map<string, ModelRoute>;
  timeoutMs: number;
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
        fallbackChain: Array.isArray(cfg.fallback_chain)
          ? cfg.fallback_chain
              .map((v) => (typeof v === "string" ? v.trim() : ""))
              .filter((v) => v.length > 0)
          : [],
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

export function createModelProxyRoutes(
  configPath: string,
  deps?: { authProfileService?: AuthProfileService },
): Hono {
  const state = loadModelGatewayConfig(configPath);
  return createModelProxyRoutesFromState(state, deps);
}

export function createModelProxyRoutesFromState(
  state: ModelGatewayState,
  deps?: { authProfileService?: AuthProfileService },
): Hono {
  const proxy = new Hono();

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
        fallback_chain: route.fallbackChain,
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

    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid JSON payload" }, 400);
    }

    const requestedModel = parsedBody["model"];
    if (!requestedModel || typeof requestedModel !== "string") {
      return c.json({ error: "request body missing 'model' field" }, 400);
    }

    const requestedRoute = state.routes.get(requestedModel);
    if (!requestedRoute) {
      return c.json({ error: `model '${requestedModel}' is not configured` }, 404);
    }

    const streamRequested = parsedBody["stream"] === true;
    const originalBody = new Uint8Array(bodyBytes);

    const modelCandidates: string[] = [];
    for (const entry of [requestedModel, ...requestedRoute.fallbackChain]) {
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim();
      if (trimmed.length === 0) continue;
      if (!modelCandidates.includes(trimmed)) modelCandidates.push(trimmed);
    }

    const sessionId = c.req.header("x-tyrum-session-id")?.trim();
    const agentId =
      c.req.header("x-tyrum-agent-id")?.trim() ||
      process.env["TYRUM_AGENT_ID"]?.trim() ||
      "default";

    const originalPath = new URL(c.req.url).pathname;

    const baseHeaders = new Headers();
    for (const [name, value] of Object.entries(c.req.header())) {
      if (typeof value !== "string") continue;
      if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
      if (name.toLowerCase() === "authorization") continue;
      baseHeaders.set(name, value);
    }
    baseHeaders.set("Content-Type", "application/json");

    function classifyFailure(status: number): {
      failure: "rate_limit" | "transient" | "auth" | "quota" | "other";
      retryable: boolean;
    } {
      if (status === 401 || status === 403) return { failure: "auth", retryable: true };
      if (status === 402) return { failure: "quota", retryable: true };
      if (status === 408) return { failure: "transient", retryable: true };
      if (status === 429) return { failure: "rate_limit", retryable: true };
      if (status >= 500) return { failure: "transient", retryable: true };
      return { failure: "other", retryable: false };
    }

    async function fetchUpstream(
      upstreamUrl: string,
      headers: Headers,
      body: Uint8Array,
    ): Promise<Response> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), state.timeoutMs);
      try {
        return await fetch(upstreamUrl, {
          method: "POST",
          headers,
          body: Buffer.from(body),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    let lastFailure:
      | { kind: "http"; status: number; headers: Headers; body: Uint8Array }
      | { kind: "fetch"; error: string }
      | undefined;

    for (const modelName of modelCandidates) {
      const route = state.routes.get(modelName);
      if (!route) {
        lastFailure = {
          kind: "fetch",
          error: `fallback model '${modelName}' is not configured`,
        };
        continue;
      }

      const upstreamUrl = route.baseUrl.replace(/\/$/, "") + originalPath;
      const body =
        modelName === requestedModel
          ? originalBody
          : new TextEncoder().encode(JSON.stringify({ ...parsedBody, model: modelName }));

      const buildResponse = async (upstreamResponse: Response): Promise<Response> => {
        const isStream =
          streamRequested ||
          upstreamResponse.headers
            .get("content-type")
            ?.startsWith("text/event-stream") === true;

        const responseHeaders = new Headers();
        upstreamResponse.headers.forEach((value, name) => {
          if (!RESPONSE_SKIP_HEADERS.has(name.toLowerCase())) {
            responseHeaders.set(name, value);
          }
        });
        responseHeaders.set("x-tyrum-model-used", modelName);
        responseHeaders.set("x-tyrum-provider-used", route.target);

        if (isStream && upstreamResponse.body) {
          return new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            headers: responseHeaders,
          });
        }

        const responseBytes = await upstreamResponse.arrayBuffer();
        return new Response(new Uint8Array(responseBytes), {
          status: upstreamResponse.status,
          headers: responseHeaders,
        });
      };

      const attemptWithHeaders = async (headers: Headers): Promise<Response | null> => {
        try {
          const res = await fetchUpstream(upstreamUrl, headers, body);
          if (res.ok) {
            return await buildResponse(res);
          }
          const bytes = new Uint8Array(await res.arrayBuffer());
          lastFailure = { kind: "http", status: res.status, headers: res.headers, body: bytes };
          return null;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          lastFailure = { kind: "fetch", error: message };
          return null;
        }
      };

      const shouldTryFallbackModel = (failure: typeof lastFailure): boolean => {
        if (!failure) return false;
        if (failure.kind === "fetch") return true;
        return classifyFailure(failure.status).retryable;
      };

      // 1) Rotate DB-backed auth profiles within provider (preferred).
      if (deps?.authProfileService && sessionId) {
        let selected: { profileId: string; token: string } | undefined;
        try {
          selected = await deps.authProfileService.resolveBearerToken({
            agentId,
            provider: route.target,
            sessionId,
          });
        } catch {
          selected = undefined;
        }

        while (selected?.token) {
          const headers = new Headers(baseHeaders);
          headers.set("Authorization", `Bearer ${selected.token}`);
          const ok = await attemptWithHeaders(headers);
          if (ok) return ok;

          if (lastFailure?.kind !== "http") break;
          const classification = classifyFailure(lastFailure.status);
          if (classification.failure === "other") break;

          try {
            selected = await deps.authProfileService.rotateBearerToken({
              agentId,
              provider: route.target,
              sessionId,
              failedProfileId: selected.profileId,
              failure: classification.failure,
            });
          } catch {
            selected = undefined;
          }
        }
      }

      // 2) Legacy static auth from config (best-effort fallback).
      {
        const headers = new Headers(baseHeaders);
        switch (route.auth.kind) {
          case "bearer":
            headers.set("Authorization", `Bearer ${route.auth.token}`);
            break;
          case "static":
            headers.set(route.auth.header, route.auth.value);
            break;
          case "none":
            break;
        }

        const ok = await attemptWithHeaders(headers);
        if (ok) return ok;
      }

      // Only continue to the next model if the failure is retryable.
      if (!shouldTryFallbackModel(lastFailure)) {
        break;
      }
    }

    if (!lastFailure) {
      return c.json({ error: "no upstream attempts were made" }, 502);
    }

    if (lastFailure.kind === "fetch") {
      return c.json(
        { error: `upstream request failed for model '${requestedModel}': ${lastFailure.error}` },
        502,
      );
    }

    const responseHeaders = new Headers();
    lastFailure.headers.forEach((value, name) => {
      if (!RESPONSE_SKIP_HEADERS.has(name.toLowerCase())) {
        responseHeaders.set(name, value);
      }
    });

    return new Response(Buffer.from(lastFailure.body), {
      status: lastFailure.status,
      headers: responseHeaders,
    });
  };

  proxy.post("/v1/completions", proxyHandler);
  proxy.post("/v1/chat/completions", proxyHandler);
  proxy.post("/v1/embeddings", proxyHandler);
  proxy.post("/v1/audio/speech", proxyHandler);

  return proxy;
}
