import { isIP } from "node:net";
import {
  BENCHMARK_PUBLIC_BASE_URL_PATH,
  buildBenchmarkMerchantSiteUrl,
  type BenchmarkFixtureSpec,
  type LiveBenchmarkScenarioSpec,
  type LiveBenchmarkSuiteSpec,
} from "@tyrum/contracts";
import type { BenchmarkHttpClient, BenchmarkOperatorConfig } from "./operator-session.js";

const LOOPBACK_HOSTNAMES = new Set(["localhost"]);

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(normalized)) {
    return true;
  }
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return normalized.startsWith("127.");
  }
  return ipVersion === 6 && (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1");
}

function readFixtureStringConfig(fixture: BenchmarkFixtureSpec, key: string): string | undefined {
  const rawValue = fixture.config[key];
  if (typeof rawValue !== "string") {
    return undefined;
  }
  const value = rawValue.trim();
  return value.length > 0 ? value : undefined;
}

async function fetchGatewayPublicBaseUrl(
  operatorConfig: BenchmarkOperatorConfig,
): Promise<string | undefined> {
  const requestUrl = new URL(BENCHMARK_PUBLIC_BASE_URL_PATH, operatorConfig.gateway_url);
  let response: Response;
  try {
    response = await fetch(requestUrl, {
      headers: { accept: "application/json" },
    });
  } catch {
    return undefined;
  }

  if (!response.ok) {
    return undefined;
  }

  let payload: unknown;
  try {
    payload = (await response.json()) as unknown;
  } catch {
    return undefined;
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const publicBaseUrl = (payload as Record<string, unknown>)["public_base_url"];
  if (typeof publicBaseUrl !== "string") {
    return undefined;
  }

  const value = publicBaseUrl.trim();
  return value.length > 0 ? value : undefined;
}

async function resolveMerchantSiteUrl(
  operatorConfig: BenchmarkOperatorConfig,
  fixture: BenchmarkFixtureSpec,
): Promise<string> {
  const explicitUrl = readFixtureStringConfig(fixture, "url");
  if (explicitUrl) {
    return new URL(explicitUrl).toString();
  }

  const explicitBaseUrl = readFixtureStringConfig(fixture, "base_url");
  if (explicitBaseUrl) {
    return buildBenchmarkMerchantSiteUrl(explicitBaseUrl);
  }

  const gatewayUrl = new URL(operatorConfig.gateway_url);
  if (!isLoopbackHostname(gatewayUrl.hostname)) {
    return buildBenchmarkMerchantSiteUrl(gatewayUrl.origin);
  }

  const publicBaseUrl = await fetchGatewayPublicBaseUrl(operatorConfig);
  if (publicBaseUrl) {
    const publicBaseUrlUrl = new URL(publicBaseUrl);
    if (!isLoopbackHostname(publicBaseUrlUrl.hostname)) {
      return buildBenchmarkMerchantSiteUrl(publicBaseUrl);
    }
  }

  throw new Error(
    `merchant fixture '${fixture.id}' requires config.base_url or a non-loopback publicBaseUrl`,
  );
}

function collectScenarioFixtures(
  suite: LiveBenchmarkSuiteSpec,
  scenario: LiveBenchmarkScenarioSpec,
): BenchmarkFixtureSpec[] {
  const fixtureById = new Map<string, BenchmarkFixtureSpec>(
    suite.fixtures.map((fixture: BenchmarkFixtureSpec) => [fixture.id, fixture]),
  );
  return scenario.environment.fixtures.flatMap((fixtureId: string) => {
    const fixture = fixtureById.get(fixtureId);
    return fixture ? [fixture] : [];
  });
}

function collectRequiredMcpToolFamilies(
  suite: LiveBenchmarkSuiteSpec,
  scenario: LiveBenchmarkScenarioSpec,
): string[] {
  const families = new Set<string>();
  for (const family of scenario.environment.required_tool_families) {
    if (family.startsWith("mcp.")) {
      families.add(family);
    }
  }
  for (const fixture of collectScenarioFixtures(suite, scenario)) {
    const toolFamily = fixture.config["tool_family"];
    if (typeof toolFamily === "string" && toolFamily.trim().startsWith("mcp.")) {
      families.add(toolFamily.trim());
    }
  }
  return [...families];
}

export async function resolveRequiredMcpServerIds(
  http: BenchmarkHttpClient,
  suite: LiveBenchmarkSuiteSpec,
  scenario: LiveBenchmarkScenarioSpec,
): Promise<string[]> {
  const requiredFamilies = collectRequiredMcpToolFamilies(suite, scenario);
  if (requiredFamilies.length === 0) {
    return [];
  }

  const registry = await http.toolRegistry.list();
  const mcpTools = registry.tools.filter(
    (tool) => tool.source === "mcp" && typeof tool.backing_server?.id === "string",
  );
  const missingFamilies: string[] = [];
  const serverIds = new Set<string>();

  for (const family of requiredFamilies) {
    const matches = mcpTools.filter((tool) => tool.canonical_id.startsWith(family));
    if (matches.length === 0) {
      missingFamilies.push(family);
      continue;
    }
    for (const match of matches) {
      if (match.backing_server) {
        serverIds.add(match.backing_server.id);
      }
    }
  }

  if (missingFamilies.length > 0) {
    const quoted = missingFamilies.map((family) => `'${family}'`).join(", ");
    const noun = missingFamilies.length === 1 ? "family" : "families";
    const verb = missingFamilies.length === 1 ? "is" : "are";
    throw new Error(`required MCP tool ${noun} ${quoted} ${verb} not available on this gateway`);
  }

  return [...serverIds];
}

export async function collectScenarioPromptDirectives(
  operatorConfig: BenchmarkOperatorConfig,
  suite: LiveBenchmarkSuiteSpec,
  scenario: LiveBenchmarkScenarioSpec,
): Promise<string[]> {
  const directives: string[] = [];

  for (const fixture of collectScenarioFixtures(suite, scenario)) {
    if (fixture.type === "merchant_site") {
      directives.push(
        `Use only the benchmark-owned merchant site at ${await resolveMerchantSiteUrl(operatorConfig, fixture)}.`,
      );
      directives.push("Do not use search engines or third-party delivery marketplaces.");
      directives.push("Complete checkout on that site and report the merchant, order id, and ETA.");
    }
    if (
      fixture.type === "approval_driver" &&
      scenario.environment.approval_mode === "must_request_autoapprove"
    ) {
      directives.push("Request approval immediately before placing the final order.");
    }
  }

  if (scenario.environment.secret_policy === "refs_only") {
    directives.push(
      "Use the provided secret tools for payment details instead of inventing or typing card data from memory.",
    );
  }

  return directives;
}

export function buildScenarioPromptMessage(
  baseMessage: string,
  promptDirectives: readonly string[],
): string {
  if (promptDirectives.length === 0) {
    return baseMessage;
  }

  return `${baseMessage}\n\nBenchmark fixture instructions:\n${promptDirectives
    .map((directive) => `- ${directive}`)
    .join("\n")}`;
}
