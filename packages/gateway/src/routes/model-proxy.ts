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

export function createModelProxyRoutes(configPath: string): Hono {
  const state = loadModelGatewayConfig(configPath);
  return createModelProxyRoutesFromState(state);
}

export function createModelProxyRoutesFromState(
  state: ModelGatewayState,
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

    // Build forwarded headers
    const forwardHeaders = new Headers();
    for (const [name, value] of Object.entries(c.req.header())) {
      if (typeof value === "string" && !HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
        // Skip authorization — we'll apply route-specific auth
        if (name.toLowerCase() !== "authorization") {
          forwardHeaders.set(name, value);
        }
      }
    }

    // Apply route auth
    switch (route.auth.kind) {
      case "bearer":
        forwardHeaders.set("Authorization", `Bearer ${route.auth.token}`);
        break;
      case "static":
        forwardHeaders.set(route.auth.header, route.auth.value);
        break;
      case "none":
        break;
    }

    forwardHeaders.set("Content-Type", "application/json");

    // Forward request to upstream
    let upstreamResponse: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        state.timeoutMs,
      );

      upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers: forwardHeaders,
        body: new Uint8Array(bodyBytes),
        signal: controller.signal,
      });

      clearTimeout(timeout);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      return c.json(
        { error: `upstream request failed for model '${modelName}': ${message}` },
        502,
      );
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
