// @vitest-environment jsdom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PolicyConfigSection } from "../../src/components/pages/admin-http-policy-config.js";
import { renderIntoDocument, setNativeValue } from "../test-utils.js";
import {
  cleanupAdminHttpPage,
  click,
  clickAndFlush,
  flush,
  getByTestId,
} from "./admin-page.http.test-support.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PolicyConfigSection save sync", () => {
  it("does not reinitialize the editor when refreshed props match the saved bundle", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    const nextRevisionBundle = {
      v: 1 as const,
      approvals: {
        auto_review: {
          mode: "auto_review" as const,
        },
      },
      tools: {
        allow: ["glob"],
        require_approval: [],
        deny: [],
      },
      network_egress: {
        default: "require_approval" as const,
        allow: [],
        require_approval: [],
        deny: [],
      },
      secrets: {
        default: "require_approval" as const,
        allow: [],
        require_approval: [],
        deny: [],
      },
      connectors: {
        default: "require_approval" as const,
        allow: ["telegram:*"],
        require_approval: [],
        deny: [],
      },
      artifacts: { default: "allow" as const },
      provenance: { untrusted_shell_requires_approval: true },
    };
    const onSave = vi.fn(async () => true);
    const page = renderIntoDocument(
      React.createElement(PolicyConfigSection, {
        effective: {
          sha256: "policy-sha-1",
          bundle: {
            v: 1,
            approvals: {
              auto_review: {
                mode: "auto_review",
              },
            },
            tools: {
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
          },
          sources: { deployment: "shared", agent: null, playbook: null },
        },
        currentRevision: {
          revision: 1,
          agent_key: null,
          bundle: {
            v: 1,
            approvals: {
              auto_review: {
                mode: "auto_review",
              },
            },
            tools: {
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
          },
          created_at: "2026-03-01T00:00:00.000Z",
          created_by: { kind: "tenant.token", token_id: "token-1" },
          reason: "seed",
          reverted_from_revision: null,
        },
        revisions: [],
        loadBusy: false,
        loadError: null,
        saveBusy: false,
        saveError: null,
        revertBusy: false,
        revertError: null,
        canMutate: true,
        requestEnter: () => {},
        onRefresh: () => {},
        onSave,
        onRevert: async () => undefined,
      }),
    );

    await flush();

    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "policy-config-tools-allow-row-0"),
        "glob",
      );
    });
    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-save"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-dialog-confirm"));
    await flush();

    randomSpy.mockClear();
    act(() => {
      page.root.render(
        React.createElement(PolicyConfigSection, {
          effective: {
            sha256: "policy-sha-2",
            bundle: nextRevisionBundle,
            sources: { deployment: "shared", agent: null, playbook: null },
          },
          currentRevision: {
            revision: 2,
            agent_key: null,
            bundle: nextRevisionBundle,
            created_at: "2026-03-02T00:00:00.000Z",
            created_by: { kind: "tenant.token", token_id: "token-1" },
            reason: "saved",
            reverted_from_revision: null,
          },
          revisions: [],
          loadBusy: false,
          loadError: null,
          saveBusy: false,
          saveError: null,
          revertBusy: false,
          revertError: null,
          canMutate: true,
          requestEnter: () => {},
          onRefresh: () => {},
          onSave,
          onRevert: async () => undefined,
        }),
      );
    });
    await flush();

    expect(randomSpy).not.toHaveBeenCalled();
    expect(page.container.textContent).toContain("No unsaved changes");

    cleanupAdminHttpPage(page);
  });
});
