import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { PolicyBundleService } from "../policy-bundle/service.js";
import type { AuthProfileService } from "../auth-profiles/service.js";

type ProviderUsageStatus = "disabled" | "ok" | "error";

export interface ProviderUsageResponse {
  status: ProviderUsageStatus;
  cachedAt?: string;
  error?: string;
  data?: unknown;
}

type ResolvedAuth =
  | { kind: "none" }
  | { kind: "bearer"; token: string }
  | { kind: "static"; header: string; value: string };

interface ProviderUsageConfig {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  timeoutMs: number;
}

interface ParsedProviderConfig {
  auth: ResolvedAuth;
  usage?: ProviderUsageConfig;
}

interface RawGatewayConfig {
  auth_profiles?: Record<string, unknown>;
}

function truthyEnv(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeHeaders(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== "string") continue;
    const key = k.trim();
    const value = v.trim();
    if (key.length === 0 || value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

function normalizeMethod(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return value === "POST" ? "POST" : "GET";
}

function resolveConfigAuth(raw: unknown): ResolvedAuth {
  if (!isRecord(raw)) return { kind: "none" };
  const type = typeof raw["type"] === "string" ? raw["type"].trim() : "";

  switch (type) {
    case "none":
      return { kind: "none" };
    case "bearer": {
      const envVar = typeof raw["env"] === "string" ? raw["env"].trim() : "";
      if (!envVar) return { kind: "none" };
      const token = process.env[envVar]?.trim();
      return token ? { kind: "bearer", token } : { kind: "none" };
    }
    case "static_header": {
      const header = typeof raw["header"] === "string" ? raw["header"].trim() : "";
      const value = typeof raw["value"] === "string" ? raw["value"].trim() : "";
      if (!header || !value) return { kind: "none" };
      return { kind: "static", header, value };
    }
    default:
      return { kind: "none" };
  }
}

function resolveUsageConfig(raw: unknown): ProviderUsageConfig | undefined {
  if (!isRecord(raw)) return undefined;

  const endpoint =
    typeof raw["usage_endpoint"] === "string"
      ? raw["usage_endpoint"].trim()
      : isRecord(raw["usage"]) && typeof raw["usage"]["endpoint"] === "string"
        ? (raw["usage"]["endpoint"] as string).trim()
        : "";
  if (!endpoint) return undefined;

  const usageObj = isRecord(raw["usage"]) ? raw["usage"] : {};
  const method = normalizeMethod(usageObj["method"]);
  const headers = sanitizeHeaders(usageObj["headers"]);
  const timeoutRaw = usageObj["timeout_ms"];
  const timeoutMs =
    typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw)
      ? Math.max(250, Math.min(60_000, Math.floor(timeoutRaw)))
      : 5_000;

  return { endpoint, method, headers, timeoutMs };
}

function loadProviderConfig(
  configPath: string,
  provider: string,
): ParsedProviderConfig {
  const raw = readFileSync(configPath, "utf8");
  const cfg = (parseYaml(raw) ?? {}) as RawGatewayConfig;
  const profiles = isRecord(cfg.auth_profiles) ? cfg.auth_profiles : {};
  const profileRaw = profiles[provider];

  return {
    auth: resolveConfigAuth(profileRaw),
    usage: resolveUsageConfig(profileRaw),
  };
}

function mergeHeaders(
  base: Record<string, string>,
  extra: Record<string, string>,
): Headers {
  const out = new Headers();
  for (const [k, v] of Object.entries(base)) out.set(k, v);
  for (const [k, v] of Object.entries(extra)) out.set(k, v);
  return out;
}

function safePreview(value: unknown, max = 120): string {
  const raw =
    typeof value === "string" ? value : value instanceof Error ? value.message : String(value);
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 3)}...`;
}

export class ProviderUsageService {
  private readonly cacheTtlMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly policyBundleService: PolicyBundleService;
  private readonly authProfileService?: AuthProfileService;
  private readonly timeoutMs: number;
  private cache = new Map<
    string,
    { cachedAtMs: number; cachedAtIso: string; value: ProviderUsageResponse; inflight?: Promise<ProviderUsageResponse> }
  >();

  constructor(opts: {
    policyBundleService: PolicyBundleService;
    authProfileService?: AuthProfileService;
    fetchImpl?: typeof fetch;
    cacheTtlMs?: number;
    timeoutMs?: number;
  }) {
    this.policyBundleService = opts.policyBundleService;
    this.authProfileService = opts.authProfileService;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.cacheTtlMs = Math.max(0, Math.floor(opts.cacheTtlMs ?? 60_000));
    this.timeoutMs = Math.max(250, Math.min(60_000, Math.floor(opts.timeoutMs ?? 8_000)));
  }

  async getUsage(opts: {
    enabled: boolean;
    modelGatewayConfigPath?: string;
    provider?: string;
    sessionId?: string;
    agentId: string;
  }): Promise<ProviderUsageResponse> {
    if (!opts.enabled) {
      return { status: "disabled" };
    }
    const provider = opts.provider?.trim();
    if (!provider) {
      return { status: "disabled", error: "provider not specified" };
    }
    const configPath = opts.modelGatewayConfigPath?.trim();
    if (!configPath) {
      return { status: "disabled", error: "MODEL_GATEWAY_CONFIG not configured" };
    }

    let parsed: ParsedProviderConfig;
    try {
      parsed = loadProviderConfig(configPath, provider);
    } catch (err) {
      return { status: "error", error: `failed to load model gateway config: ${safePreview(err)}` };
    }

    if (!parsed.usage) {
      return { status: "disabled" };
    }

    const cacheKeyBase = `provider-usage:${provider}:session:${opts.sessionId ?? "global"}:endpoint:${parsed.usage.endpoint}`;
    const nowMs = Date.now();
    const cached = this.cache.get(cacheKeyBase);
    if (cached && nowMs - cached.cachedAtMs < this.cacheTtlMs) {
      return cached.value;
    }

    if (cached?.inflight) {
      return await cached.inflight;
    }

    const inflight = this.fetchAndCache(cacheKeyBase, parsed, {
      agentId: opts.agentId,
      provider,
      sessionId: opts.sessionId,
      nowMs,
      cached,
    });
    this.cache.set(cacheKeyBase, {
      cachedAtMs: cached?.cachedAtMs ?? 0,
      cachedAtIso: cached?.cachedAtIso ?? "",
      value: cached?.value ?? { status: "disabled" },
      inflight,
    });
    return await inflight;
  }

  private async fetchAndCache(
    cacheKeyBase: string,
    parsed: ParsedProviderConfig,
    opts: {
      agentId: string;
      provider: string;
      sessionId?: string;
      nowMs: number;
      cached?: { cachedAtMs: number; cachedAtIso: string; value: ProviderUsageResponse };
    },
  ): Promise<ProviderUsageResponse> {
    const usage = parsed.usage!;
    const method = usage.method;

    const policyEval = await this.policyBundleService.evaluateAction(
      {
        type: "Http",
        args: {
          url: usage.endpoint,
          method,
          purpose: "provider_usage",
          provider: opts.provider,
        },
      },
      { agentId: opts.agentId, provenance: { sources: ["system"] } },
    );

    if (policyEval.decision !== "allow") {
      const error =
        policyEval.decision === "deny"
          ? "provider usage polling denied by policy"
          : "provider usage polling requires approval by policy";
      const value: ProviderUsageResponse = { status: "error", error };
      this.cache.set(cacheKeyBase, {
        cachedAtMs: Date.now(),
        cachedAtIso: new Date().toISOString(),
        value,
      });
      return value;
    }

    let resolvedAuth: ResolvedAuth = parsed.auth;
    if (this.authProfileService && opts.sessionId) {
      try {
        const token = await this.authProfileService.resolveBearerToken({
          agentId: opts.agentId,
          provider: opts.provider,
          sessionId: opts.sessionId,
        });
        if (token?.token) {
          resolvedAuth = { kind: "bearer", token: token.token };
        }
      } catch {
        // best-effort
      }
    }

    if (resolvedAuth.kind === "none") {
      return { status: "disabled", error: "no auth available for provider usage polling" };
    }

    const headers = mergeHeaders(
      {
        "Content-Type": "application/json",
        "User-Agent": "tyrum-gateway/usage",
      },
      usage.headers,
    );
    if (resolvedAuth.kind === "bearer") {
      headers.set("Authorization", `Bearer ${resolvedAuth.token}`);
    } else if (resolvedAuth.kind === "static") {
      headers.set(resolvedAuth.header, resolvedAuth.value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, usage.timeoutMs));

    const cachedOkData =
      opts.cached?.value.status === "ok" ? opts.cached.value.data : undefined;
    const cachedOkAt = opts.cached?.value.status === "ok" ? opts.cached.value.cachedAt : undefined;

    try {
      const res = await this.fetchImpl(usage.endpoint, {
        method,
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        const error = `provider usage polling failed: HTTP ${res.status}`;
        const value: ProviderUsageResponse = {
          status: "error",
          error,
          cachedAt: cachedOkAt,
          data: cachedOkData,
        };
        this.cache.set(cacheKeyBase, {
          cachedAtMs: Date.now(),
          cachedAtIso: new Date().toISOString(),
          value,
        });
        return value;
      }

      const text = await res.text();
      const data = (() => {
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      })();

      const nowIso = new Date().toISOString();
      const value: ProviderUsageResponse = { status: "ok", cachedAt: nowIso, data };
      this.cache.set(cacheKeyBase, { cachedAtMs: Date.now(), cachedAtIso: nowIso, value });
      return value;
    } catch (err) {
      const error = `provider usage polling failed: ${safePreview(err)}`;
      const value: ProviderUsageResponse = {
        status: "error",
        error,
        cachedAt: cachedOkAt,
        data: cachedOkData,
      };
      this.cache.set(cacheKeyBase, {
        cachedAtMs: Date.now(),
        cachedAtIso: new Date().toISOString(),
        value,
      });
      return value;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function providerUsagePollingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return truthyEnv(env["TYRUM_PROVIDER_USAGE_POLLING"]) || truthyEnv(env["GATEWAY_PROVIDER_USAGE_POLLING"]);
}
