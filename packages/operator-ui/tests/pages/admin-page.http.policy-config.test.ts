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
  setSelectValue,
} from "./admin-page.http.test-support.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PolicyConfigSection", () => {
  it("clears the save reason after a successful policy save", async () => {
    const onSave = vi.fn(async () => true);
    const page = renderIntoDocument(
      React.createElement(PolicyConfigSection, {
        effective: {
          sha256: "policy-sha-1",
          bundle: {
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
          },
          sources: { deployment: "default", agent: null, playbook: null },
        },
        currentRevision: null,
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

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-tools-allow-add"));
    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "policy-config-tools-allow-row-0"),
        "glob",
      );
    });
    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "policy-config-save-reason"),
        "Tighten nothing yet",
      );
    });

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-save"));
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
    await flush();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({ allow: ["glob"] }),
      }),
      "Tighten nothing yet",
    );
    expect(getByTestId<HTMLInputElement>(page.container, "policy-config-save-reason").value).toBe(
      "",
    );

    cleanupAdminHttpPage(page);
  });

  it("saves the approvals auto-review mode from the editor", async () => {
    const onSave = vi.fn(async () => true);
    const page = renderIntoDocument(
      React.createElement(PolicyConfigSection, {
        effective: {
          sha256: "policy-sha-approvals",
          bundle: {
            v: 1,
            approvals: {
              auto_review: {
                mode: "auto_review",
              },
            },
          },
          sources: { deployment: "default", agent: null, playbook: null },
        },
        currentRevision: null,
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

    setSelectValue(
      getByTestId<HTMLSelectElement>(page.container, "policy-config-approvals-auto-review-mode"),
      "manual_only",
    );

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-save"));
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
    await flush();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        approvals: {
          auto_review: {
            mode: "manual_only",
          },
        },
      }),
      "",
    );

    cleanupAdminHttpPage(page);
  });

  it("resets the dirty state after a successful save even before refreshed props arrive", async () => {
    const onSave = vi.fn(async () => true);
    const page = renderIntoDocument(
      React.createElement(PolicyConfigSection, {
        effective: {
          sha256: "policy-sha-1",
          bundle: {
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
          },
          sources: { deployment: "default", agent: null, playbook: null },
        },
        currentRevision: null,
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

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-tools-allow-add"));
    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "policy-config-tools-allow-row-0"),
        "glob",
      );
    });

    expect(page.container.textContent).toContain("Unsaved changes ready");
    expect(getByTestId<HTMLButtonElement>(page.container, "policy-config-save").disabled).toBe(
      false,
    );

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-save"));
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
    await flush();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(page.container.textContent).toContain("No unsaved changes");
    expect(getByTestId<HTMLButtonElement>(page.container, "policy-config-save").disabled).toBe(
      true,
    );

    cleanupAdminHttpPage(page);
  });

  it("preserves dirty state and save reason when saving is aborted", async () => {
    const onSave = vi.fn(async () => false);
    const page = renderIntoDocument(
      React.createElement(PolicyConfigSection, {
        effective: {
          sha256: "policy-sha-1",
          bundle: {
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
          },
          sources: { deployment: "default", agent: null, playbook: null },
        },
        currentRevision: null,
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

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-tools-allow-add"));
    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "policy-config-tools-allow-row-0"),
        "glob",
      );
    });
    act(() => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "policy-config-save-reason"),
        "Keep this draft",
      );
    });

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-save"));
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
    await flush();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(page.container.textContent).toContain("Unsaved changes ready");
    expect(getByTestId<HTMLButtonElement>(page.container, "policy-config-save").disabled).toBe(
      false,
    );
    expect(getByTestId<HTMLInputElement>(page.container, "policy-config-save-reason").value).toBe(
      "Keep this draft",
    );

    cleanupAdminHttpPage(page);
  });

  it("preserves batched domain edits before saving", async () => {
    const onSave = vi.fn(async () => true);
    const page = renderIntoDocument(
      React.createElement(PolicyConfigSection, {
        effective: {
          sha256: "policy-sha-1",
          bundle: {
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
          },
          sources: { deployment: "default", agent: null, playbook: null },
        },
        currentRevision: null,
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

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-tools-allow-add"));
    await flush();
    await act(async () => {
      setNativeValue(
        getByTestId<HTMLInputElement>(page.container, "policy-config-tools-allow-row-0"),
        "glob",
      );
      setSelectValue(
        getByTestId<HTMLSelectElement>(page.container, "policy-config-network-default"),
        "allow",
      );
    });

    click(getByTestId<HTMLButtonElement>(page.container, "policy-config-save"));
    click(getByTestId<HTMLElement>(document.body, "confirm-danger-checkbox"));
    await clickAndFlush(getByTestId<HTMLButtonElement>(document.body, "confirm-danger-confirm"));
    await flush();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({ allow: ["glob"] }),
        network_egress: expect.objectContaining({ default: "allow" }),
      }),
      "",
    );

    cleanupAdminHttpPage(page);
  });

  it("initializes the editor from the saved deployment bundle instead of the effective bundle", async () => {
    const page = renderIntoDocument(
      React.createElement(PolicyConfigSection, {
        effective: {
          sha256: "policy-sha-1",
          bundle: {
            v: 1,
            tools: {
              default: "require_approval",
              allow: ["read"],
              require_approval: [],
              deny: ["bash"],
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
          sources: { deployment: "shared", agent: "default", playbook: null },
        },
        currentRevision: {
          revision: 7,
          agent_key: null,
          bundle: {
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
        onSave: async () => true,
        onRevert: async () => undefined,
      }),
    );

    await flush();

    expect(
      page.container.querySelector("[data-testid='policy-config-tools-deny-row-0']"),
    ).toBeNull();
    expect(page.container.textContent).toContain("No unsaved changes");
    expect(getByTestId<HTMLButtonElement>(page.container, "policy-config-save").disabled).toBe(
      true,
    );

    cleanupAdminHttpPage(page);
  });
});
