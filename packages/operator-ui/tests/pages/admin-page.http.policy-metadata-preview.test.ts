// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyConfigSection } from "../../src/components/pages/admin-http-policy-config.js";
import {
  cleanupAdminHttpPage,
  flush,
  getByTestId,
  renderAdminHttpConfigurePage,
  switchHttpTab,
  waitForTestId,
} from "./admin-page.http.test-support.js";
import { createPolicyToolRegistryRows, requestUrl } from "./admin-page.http.policy.test-support.js";
import { renderIntoDocument } from "../test-utils.js";
import { jsonResponse, createAdminHttpTestCore } from "./admin-page.http.test-support.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Policy metadata preview", () => {
  it("renders canonical metadata for exact tool matches and keeps raw rules readable", async () => {
    const currentRevision = {
      revision: 7,
      agent_key: null,
      bundle: {
        v: 1,
        tools: {
          default: "require_approval",
          allow: ["read", "tool.fs.read", "tool.fs.*"],
          require_approval: ["mcp.memory.write", "tool.internal.inspect"],
          deny: ["tool.unknown"],
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
      },
      created_at: "2026-03-01T00:00:00.000Z",
      created_by: { kind: "tenant.token", token_id: "token-1" },
      reason: "seed",
      reverted_from_revision: null,
    } as const;

    const page = renderIntoDocument(
      React.createElement(PolicyConfigSection, {
        effective: {
          sha256: "policy-sha-tool-preview",
          bundle: currentRevision.bundle,
          sources: { deployment: "default", agent: null, playbook: null },
        },
        currentRevision,
        revisions: [],
        loadBusy: false,
        loadError: null,
        saveBusy: false,
        revertBusy: false,
        canMutate: true,
        requestEnter: () => {},
        onRefresh: () => {},
        onSave: async () => true,
        onRevert: async () => undefined,
        toolRegistry: createPolicyToolRegistryRows(),
      }),
    );

    await flush();
    await waitForTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-0");

    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-0").textContent,
    ).toContain("Canonical ID");
    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-0").textContent,
    ).toContain("read");
    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-0").textContent,
    ).toContain("canonical");
    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-0").textContent,
    ).toContain("public");
    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-0").textContent,
    ).toContain("tool.fs.read (alias)");

    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-1").textContent,
    ).toContain("Canonical ID");
    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-1").textContent,
    ).toContain("read");
    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-1").textContent,
    ).toContain("tool.fs.read (alias)");

    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-2").textContent,
    ).toContain("Pattern rule");
    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-2").textContent,
    ).toContain("tool.fs.*");
    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-2").textContent,
    ).toContain("not forced into a canonical match");
    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-approval-metadata-0")
        .textContent,
    ).toContain("mcp.memory.write (deprecated)");
    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-approval-metadata-1")
        .textContent,
    ).toContain("internal");
    expect(
      getByTestId<HTMLElement>(page.container, "policy-config-tools-deny-metadata-0").textContent,
    ).toContain("Stored rule");

    cleanupAdminHttpPage(page);
  });

  it("passes loaded tool registry rows into the policy metadata preview", async () => {
    const { core } = createAdminHttpTestCore();
    const previewBundle = {
      v: 1,
      tools: {
        default: "require_approval",
        allow: ["read", "tool.fs.read", "tool.fs.*"],
        require_approval: ["mcp.memory.write", "tool.internal.inspect"],
        deny: ["tool.unknown"],
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
    const registryRows = createPolicyToolRegistryRows();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? "GET";
      if (method !== "GET") {
        throw new Error(`Unexpected ${method} request to ${url}`);
      }
      if (url === "http://example.test/policy/bundle") {
        return jsonResponse({
          status: "ok",
          generated_at: "2026-03-01T00:00:00.000Z",
          effective: {
            sha256: "policy-sha-metadata-preview",
            bundle: previewBundle,
            sources: { deployment: "default", agent: null, playbook: null },
          },
        });
      }
      if (url === "http://example.test/config/policy/deployment") {
        return jsonResponse({
          revision: 7,
          agent_key: null,
          bundle: previewBundle,
          created_at: "2026-03-01T00:00:00.000Z",
          created_by: { kind: "tenant.token", token_id: "token-1" },
          reason: "seed",
          reverted_from_revision: null,
        });
      }
      if (url === "http://example.test/config/policy/deployment/revisions") {
        return jsonResponse({
          revisions: [
            {
              revision: 7,
              agent_key: null,
              created_at: "2026-03-01T00:00:00.000Z",
              created_by: { kind: "tenant.token", token_id: "token-1" },
              reason: "seed",
              reverted_from_revision: null,
            },
          ],
        });
      }
      if (url === "http://example.test/config/tools") {
        return jsonResponse({ status: "ok", tools: registryRows });
      }
      if (url.startsWith("http://example.test/policy/overrides")) {
        return jsonResponse({ overrides: [] });
      }
      if (url === "http://example.test/agents") {
        return jsonResponse({ agents: [] });
      }
      throw new Error(`Unexpected request to ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const page = renderAdminHttpConfigurePage(core);
    await switchHttpTab(page.container, "admin-http-tab-policy");
    await flush();
    await flush();
    await waitForTestId<HTMLElement>(page.container, "policy-config-tools-allow-metadata-0");

    expect(page.container.textContent).toContain("tool.fs.read (alias)");
    expect(page.container.textContent).toContain("mcp.memory.write (deprecated)");
    expect(page.container.textContent).toContain("tool.internal.inspect");

    cleanupAdminHttpPage(page);
  });
});
