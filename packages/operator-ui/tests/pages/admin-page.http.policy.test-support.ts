import { jsonResponse } from "./admin-page.http.test-support.js";

const POLICY_PAGE_BUNDLE = {
  v: 1,
  tools: {
    default: "require_approval",
    allow: ["read"],
    require_approval: [],
    deny: [],
  },
  network_egress: {
    default: "require_approval",
    allow: [],
    require_approval: [],
    deny: [],
  },
  secrets: {
    default: "require_approval",
    allow: [],
    require_approval: [],
    deny: [],
  },
  connectors: {
    default: "require_approval",
    allow: ["telegram:*"],
    require_approval: [],
    deny: [],
  },
  artifacts: { default: "allow" },
  provenance: { untrusted_shell_requires_approval: true },
} as const;

export function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

export function matchMutation(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  url: string,
  method: string,
): boolean {
  return requestUrl(input) === url && (init?.method ?? "GET") === method;
}

export function policyPageGetResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
): Response | null {
  const url = requestUrl(input);
  const method = init?.method ?? "GET";
  if (method !== "GET") return null;
  if (url === "http://example.test/policy/bundle") {
    return jsonResponse({
      status: "ok",
      generated_at: "2026-03-01T00:00:00.000Z",
      effective: {
        sha256: "policy-sha-1",
        bundle: POLICY_PAGE_BUNDLE,
        sources: { deployment: "default", agent: null, playbook: null },
      },
    });
  }
  if (url === "http://example.test/config/policy/deployment") {
    return jsonResponse({ error: "not_found", message: "policy bundle config not found" }, 404);
  }
  if (url === "http://example.test/config/policy/deployment/revisions") {
    return jsonResponse({ revisions: [] });
  }
  if (url.startsWith("http://example.test/policy/overrides")) {
    return jsonResponse({ overrides: [] });
  }
  if (url === "http://example.test/agents") {
    return jsonResponse({
      agents: [
        {
          agent_id: "00000000-0000-4000-8000-000000000002",
          agent_key: "default",
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
          has_config: true,
          has_identity: true,
          is_primary: true,
          can_delete: false,
          persona: {
            name: "Default Agent",
            description: "Primary operator",
            tone: "Direct",
            palette: "neutral",
            character: "operator",
          },
        },
      ],
    });
  }
  if (url === "http://example.test/config/tools") {
    return jsonResponse({
      status: "ok",
      tools: [
        {
          source: "builtin",
          canonical_id: "read",
          description: "Read files from disk.",
          effect: "read_only",
          effective_exposure: {
            enabled: true,
            reason: "enabled",
            agent_key: "default",
          },
        },
      ],
    });
  }
  return null;
}

export function policyPageWritableConfigGetResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
): Response | null {
  const url = requestUrl(input);
  const method = init?.method ?? "GET";
  if (method !== "GET") return null;
  if (url === "http://example.test/config/policy/deployment") {
    return jsonResponse({
      revision: 1,
      agent_key: null,
      bundle: POLICY_PAGE_BUNDLE,
      created_at: "2026-03-01T00:00:00.000Z",
      created_by: { kind: "tenant.token", token_id: "token-1" },
      reason: null,
      reverted_from_revision: null,
    });
  }
  if (url === "http://example.test/config/policy/deployment/revisions") {
    return jsonResponse({ revisions: [] });
  }
  return null;
}
