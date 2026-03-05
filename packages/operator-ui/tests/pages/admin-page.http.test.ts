// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createElevatedModeStore, type OperatorCore } from "../../../operator-core/src/index.js";
import { ElevatedModeProvider } from "../../src/elevated-mode.js";
import { ConfigurePage } from "../../src/components/pages/configure-page.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const EXECUTION_PROFILE_IDS = [
  "interaction",
  "explorer_ro",
  "reviewer_ro",
  "planner",
  "jury",
  "executor_rw",
  "integrator",
] as const;

async function switchHttpTab(
  container: HTMLElement,
  tabTestId: string,
): Promise<HTMLButtonElement> {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${tabTestId}"]`);
  expect(button).not.toBeNull();
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await Promise.resolve();
  });
  return button!;
}

function openPolicyTab(container: HTMLElement): void {
  const trigger = container.querySelector<HTMLButtonElement>(
    "[data-testid='admin-http-tab-policy']",
  );
  expect(trigger).not.toBeNull();

  act(() => {
    trigger?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function createTestCore(): {
  core: OperatorCore;
  routingConfigUpdate: ReturnType<typeof vi.fn>;
  secretsRotate: ReturnType<typeof vi.fn>;
  policyCreateOverride: ReturnType<typeof vi.fn>;
} {
  const elevatedModeStore = createElevatedModeStore({
    tickIntervalMs: 0,
    now: () => Date.parse("2026-03-01T00:00:00.000Z"),
  });
  elevatedModeStore.enter({
    elevatedToken: "test-elevated-token",
    expiresAt: "2026-03-01T00:01:00.000Z",
  });

  const routingConfigUpdate = vi.fn(async () => ({ revision: 1, config: { v: 1 } }) as unknown);
  const secretsRotate = vi.fn(async () => ({ revoked: true, handle: {} }) as unknown);
  const policyCreateOverride = vi.fn(async () => ({ status: "ok" }) as unknown);

  const core = {
    httpBaseUrl: "http://example.test",
    elevatedModeStore,
    http: {
      policy: {
        getBundle: vi.fn(async () => ({ status: "ok" }) as unknown),
        listOverrides: vi.fn(async () => ({ status: "ok", overrides: [] }) as unknown),
        createOverride: policyCreateOverride,
        revokeOverride: vi.fn(async () => ({ status: "ok" }) as unknown),
      },
      authProfiles: {
        list: vi.fn(async () => ({ status: "ok", profiles: [] }) as unknown),
        create: vi.fn(async () => ({ status: "ok" }) as unknown),
        update: vi.fn(async () => ({ status: "ok" }) as unknown),
        disable: vi.fn(async () => ({ status: "ok" }) as unknown),
        enable: vi.fn(async () => ({ status: "ok" }) as unknown),
      },
      authPins: {
        list: vi.fn(async () => ({ status: "ok", pins: [] }) as unknown),
        set: vi.fn(async () => ({ status: "ok" }) as unknown),
      },
      providerConfig: {
        listRegistry: vi.fn(async () => ({
          status: "ok",
          providers: [
            {
              provider_key: "openai",
              name: "OpenAI",
              doc: null,
              supported: true,
              methods: [
                {
                  method_key: "api_key",
                  label: "API key",
                  type: "api_key",
                  fields: [
                    {
                      key: "api_key",
                      label: "API key",
                      description: null,
                      kind: "secret",
                      input: "password",
                      required: true,
                    },
                  ],
                },
              ],
            },
          ],
        })),
        listProviders: vi.fn(async () => ({ status: "ok", providers: [] }) as unknown),
        createAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
        updateAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
        deleteAccount: vi.fn(async () => ({ status: "ok" }) as unknown),
        deleteProvider: vi.fn(async () => ({ status: "ok" }) as unknown),
      },
      routingConfig: {
        get: vi.fn(async () => ({ revision: 0, config: { v: 1 } }) as unknown),
        update: routingConfigUpdate,
        revert: vi.fn(async () => ({ revision: 0, config: { v: 1 } }) as unknown),
      },
      secrets: {
        store: vi.fn(async () => ({ handle: {} }) as unknown),
        list: vi.fn(async () => ({ handles: [] }) as unknown),
        rotate: secretsRotate,
        revoke: vi.fn(async () => ({ revoked: true }) as unknown),
      },
      modelConfig: {
        listPresets: vi.fn(async () => ({ status: "ok", presets: [] }) as unknown),
        listAvailable: vi.fn(async () => ({ status: "ok", models: [] }) as unknown),
        createPreset: vi.fn(async () => ({ status: "ok" }) as unknown),
        updatePreset: vi.fn(async () => ({ status: "ok" }) as unknown),
        deletePreset: vi.fn(async () => ({ status: "ok" }) as unknown),
        listAssignments: vi.fn(
          async () =>
            ({
              status: "ok",
              assignments: EXECUTION_PROFILE_IDS.map((execution_profile_id) => ({
                execution_profile_id,
                preset_key: "preset-default",
                preset_display_name: "Default",
                provider_key: "openai",
                model_id: "gpt-4.1",
              })),
            }) as unknown,
        ),
        updateAssignments: vi.fn(async () => ({ status: "ok", assignments: [] }) as unknown),
      },
    },
  } as unknown as OperatorCore;

  return { core, routingConfigUpdate, secretsRotate, policyCreateOverride };
}

describe("ConfigurePage (HTTP)", () => {
  it("renders Routing config and Secrets panels", async () => {
    const { core } = createTestCore();

    const { container, root } = renderIntoDocument(
      React.createElement(ElevatedModeProvider, { core, mode: "web" }, [
        React.createElement(ConfigurePage, { key: "page", core }),
      ]),
    );

    await switchHttpTab(container, "admin-http-tab-routing-config");
    expect(container.querySelector(`[data-testid="admin-http-routing-config"]`)).not.toBeNull();

    await switchHttpTab(container, "admin-http-tab-secrets");
    expect(container.querySelector(`[data-testid="admin-http-secrets"]`)).not.toBeNull();

    cleanupTestRoot({ container, root });
  });

  it("enables saving the first execution-profile assignment set", async () => {
    const { core } = createTestCore();
    const modelConfig = core.http.modelConfig as {
      listPresets: ReturnType<typeof vi.fn>;
      listAvailable: ReturnType<typeof vi.fn>;
      listAssignments: ReturnType<typeof vi.fn>;
    };
    modelConfig.listPresets = vi.fn(async () => ({
      status: "ok",
      presets: [
        {
          preset_id: "c2d1f6c6-f541-46a8-9f47-8a2d0ff3c9e5",
          preset_key: "preset-default",
          display_name: "Default",
          provider_key: "openai",
          model_id: "gpt-4.1",
          options: {},
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
        {
          preset_id: "d5c709e9-4585-426e-81ed-7904f7fbbe1b",
          preset_key: "preset-review",
          display_name: "Review",
          provider_key: "openai",
          model_id: "gpt-4.1-mini",
          options: {},
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
      ],
    }));
    modelConfig.listAvailable = vi.fn(async () => ({
      status: "ok",
      models: [
        {
          provider_key: "openai",
          provider_name: "OpenAI",
          model_id: "gpt-4.1",
          model_name: "GPT-4.1",
          family: null,
          reasoning: true,
          tool_call: true,
          modalities: { output: ["text"] },
        },
      ],
    }));
    modelConfig.listAssignments = vi.fn(async () => ({
      status: "ok",
      assignments: [],
    }));

    const { container, root } = renderIntoDocument(
      React.createElement(ElevatedModeProvider, { core, mode: "web" }, [
        React.createElement(ConfigurePage, { key: "page", core }),
      ]),
    );

    await switchHttpTab(container, "admin-http-tab-models");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const selects = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    expect(selects.length).toBe(EXECUTION_PROFILE_IDS.length);

    const saveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="models-assignments-save"]',
    );
    expect(saveButton).not.toBeNull();
    expect(saveButton?.disabled).toBe(true);

    for (const select of selects) {
      act(() => {
        const setValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")
          ?.set as ((this: HTMLSelectElement, value: string) => void) | undefined;
        setValue?.call(select, "preset-review");
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    expect(saveButton?.disabled).toBe(false);

    cleanupTestRoot({ container, root });
  });
});

describe("ConfigurePage (HTTP) routing config", () => {
  it("requires confirmation before updating routing config", async () => {
    const { core, routingConfigUpdate } = createTestCore();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
      expect(url).toBe("http://example.test/routing/config");
      expect(init?.method).toBe("PUT");

      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-elevated-token");

      const bodyRaw = String(init?.body ?? "");
      expect(JSON.parse(bodyRaw)).toEqual({ config: { v: 1 } });

      return new Response(JSON.stringify({ revision: 1, config: { v: 1 } }), { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = renderIntoDocument(
      React.createElement(ElevatedModeProvider, { core, mode: "web" }, [
        React.createElement(ConfigurePage, { key: "page", core }),
      ]),
    );

    await switchHttpTab(container, "admin-http-tab-routing-config");

    const configTextarea = container.querySelector<HTMLTextAreaElement>(
      `[data-testid="routing-config-update-json"]`,
    );
    expect(configTextarea).not.toBeNull();

    act(() => {
      if (!configTextarea) return;
      setNativeValue(configTextarea, JSON.stringify({ v: 1 }));
    });

    const openConfirm = container.querySelector<HTMLButtonElement>(
      `[data-testid="routing-config-update-open"]`,
    );
    expect(openConfirm).not.toBeNull();
    expect(openConfirm?.disabled).toBe(false);

    act(() => {
      openConfirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector(`[data-testid="confirm-danger-dialog"]`);
    expect(dialog).not.toBeNull();

    const confirmButton = document.body.querySelector<HTMLButtonElement>(
      `[data-testid="confirm-danger-confirm"]`,
    );
    expect(confirmButton).not.toBeNull();
    expect(confirmButton?.disabled).toBe(true);

    const checkbox = document.body.querySelector(`[data-testid="confirm-danger-checkbox"]`);
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmButton?.disabled).toBe(false);

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(routingConfigUpdate).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    cleanupTestRoot({ container, root });
  });
});

describe("ConfigurePage (HTTP) secrets", () => {
  it("preserves whitespace when rotating secrets", async () => {
    const { core, secretsRotate } = createTestCore();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
      expect(url).toBe("http://example.test/secrets/h-1/rotate");
      expect(init?.method).toBe("POST");

      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-elevated-token");

      const bodyRaw = String(init?.body ?? "");
      expect(JSON.parse(bodyRaw)).toEqual({ value: "  new-secret  " });

      return new Response(
        JSON.stringify({
          revoked: true,
          handle: {
            handle_id: "h-1",
            provider: "db",
            scope: "h-1",
            created_at: "2026-03-01T00:00:00.000Z",
          },
        }),
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = renderIntoDocument(
      React.createElement(ElevatedModeProvider, { core, mode: "web" }, [
        React.createElement(ConfigurePage, { key: "page", core }),
      ]),
    );

    await switchHttpTab(container, "admin-http-tab-secrets");

    const rotateButton = container.querySelector<HTMLButtonElement>(
      `[data-testid="secrets-rotate-open"]`,
    );
    expect(rotateButton).not.toBeNull();

    const rotateCard = container.querySelector<HTMLDivElement>(
      `[data-testid="secrets-rotate-card"]`,
    );
    expect(rotateCard).not.toBeNull();

    const labels = Array.from(rotateCard?.querySelectorAll<HTMLLabelElement>("label") ?? []);

    const handleIdLabel = labels.find((label) => label.textContent?.trim().startsWith("Handle ID"));
    expect(handleIdLabel).toBeDefined();
    const handleId = handleIdLabel?.getAttribute("for") ?? "";
    expect(handleId).toBeTruthy();
    const handleIdInput = rotateCard?.querySelector<HTMLInputElement>(`input[id="${handleId}"]`);
    expect(handleIdInput).not.toBeNull();

    const valueLabel = labels.find((label) => label.textContent?.trim().startsWith("New value"));
    expect(valueLabel).toBeDefined();
    const valueId = valueLabel?.getAttribute("for") ?? "";
    expect(valueId).toBeTruthy();
    const valueInput = rotateCard?.querySelector<HTMLInputElement>(`input[id="${valueId}"]`);
    expect(valueInput).not.toBeNull();

    act(() => {
      setNativeValue(handleIdInput!, "h-1");
      setNativeValue(valueInput!, "  new-secret  ");
    });

    expect(rotateButton?.disabled).toBe(false);

    act(() => {
      rotateButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector(`[data-testid="confirm-danger-dialog"]`);
    expect(dialog).not.toBeNull();

    const checkbox = document.body.querySelector(`[data-testid="confirm-danger-checkbox"]`);
    expect(checkbox).not.toBeNull();

    const confirmButton = document.body.querySelector<HTMLButtonElement>(
      `[data-testid="confirm-danger-confirm"]`,
    );
    expect(confirmButton).not.toBeNull();

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(secretsRotate).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    cleanupTestRoot({ container, root });
  });
});

describe("ConfigurePage (HTTP) policy + config", () => {
  it("renders Policy, Providers, and Models panels when Elevated Mode is active", async () => {
    const { core } = createTestCore();

    const { container, root } = renderIntoDocument(
      React.createElement(ElevatedModeProvider, { core, mode: "web" }, [
        React.createElement(ConfigurePage, { key: "page", core }),
      ]),
    );

    await switchHttpTab(container, "admin-http-tab-policy");

    expect(container.querySelector("[data-testid='admin-http-policy']")).not.toBeNull();

    await switchHttpTab(container, "admin-http-tab-providers");
    expect(container.querySelector("[data-testid='admin-http-providers']")).not.toBeNull();

    await switchHttpTab(container, "admin-http-tab-models");
    expect(container.querySelector("[data-testid='admin-http-models']")).not.toBeNull();

    cleanupTestRoot({ container, root });
  });

  it("disables policy override creation when JSON is invalid", async () => {
    const elevatedModeStore = createElevatedModeStore({ tickIntervalMs: 0 });
    elevatedModeStore.enter({
      elevatedToken: "elevated",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    const core = {
      httpBaseUrl: "http://example.test",
      elevatedModeStore,
    } as unknown as OperatorCore;

    const { container, root } = renderIntoDocument(
      React.createElement(ElevatedModeProvider, {
        core,
        mode: "web",
        children: React.createElement(ConfigurePage, { core }),
      }),
    );

    openPolicyTab(container);

    const jsonTextarea = container.querySelector<HTMLTextAreaElement>(
      "[data-testid='admin-policy-override-create-json']",
    );
    expect(jsonTextarea).not.toBeNull();

    await act(async () => {
      setNativeValue(jsonTextarea as HTMLTextAreaElement, "{");
      await Promise.resolve();
    });

    const createButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='admin-policy-override-create']",
    );
    expect(createButton).not.toBeNull();
    expect(createButton?.disabled).toBe(true);

    cleanupTestRoot({ container, root });
    elevatedModeStore.dispose();
  });

  it("disables model creation when no provider models are available", async () => {
    const { core } = createTestCore();

    const { container, root } = renderIntoDocument(
      React.createElement(ElevatedModeProvider, { core, mode: "web" }, [
        React.createElement(ConfigurePage, { key: "page", core }),
      ]),
    );

    await switchHttpTab(container, "admin-http-tab-models");

    const addButton = container.querySelector<HTMLButtonElement>("[data-testid='models-add-open']");
    expect(addButton).not.toBeNull();
    expect(addButton?.disabled).toBe(true);

    cleanupTestRoot({ container, root });
  });

  it("requires confirmation before creating policy overrides", async () => {
    const { core, policyCreateOverride } = createTestCore();

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : "";
      expect(url).toBe("http://example.test/policy/overrides");
      expect(init?.method).toBe("POST");

      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer test-elevated-token");

      const bodyRaw = String(init?.body ?? "");
      expect(JSON.parse(bodyRaw)).toEqual({
        agent_id: "00000000-0000-4000-8000-000000000002",
        tool_id: "tool-1",
        pattern: ".*",
      });

      return new Response(
        JSON.stringify({
          override: {
            policy_override_id: "00000000-0000-0000-0000-000000000001",
            status: "active",
            created_at: "2026-03-01T00:00:00.000Z",
            agent_id: "00000000-0000-4000-8000-000000000002",
            tool_id: "tool-1",
            pattern: ".*",
          },
        }),
        { status: 201 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container, root } = renderIntoDocument(
      React.createElement(ElevatedModeProvider, { core, mode: "web" }, [
        React.createElement(ConfigurePage, { key: "page", core }),
      ]),
    );

    await switchHttpTab(container, "admin-http-tab-policy");

    const jsonTextarea = container.querySelector<HTMLTextAreaElement>(
      "[data-testid='admin-policy-override-create-json']",
    );
    expect(jsonTextarea).not.toBeNull();

    await act(async () => {
      setNativeValue(
        jsonTextarea as HTMLTextAreaElement,
        JSON.stringify(
          {
            agent_id: "00000000-0000-4000-8000-000000000002",
            tool_id: "tool-1",
            pattern: ".*",
          },
          null,
          2,
        ),
      );
      await Promise.resolve();
    });

    const createButton = container.querySelector<HTMLButtonElement>(
      "[data-testid='admin-policy-override-create']",
    );
    expect(createButton).not.toBeNull();

    act(() => {
      createButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(policyCreateOverride).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(0);

    const confirmButton = document.body.querySelector<HTMLButtonElement>(
      "[data-testid='confirm-danger-confirm']",
    );
    expect(confirmButton).not.toBeNull();
    expect(confirmButton?.disabled).toBe(true);

    const checkbox = document.body.querySelector("[data-testid='confirm-danger-checkbox']");
    expect(checkbox).not.toBeNull();

    act(() => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(confirmButton?.disabled).toBe(false);

    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(policyCreateOverride).toHaveBeenCalledTimes(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    cleanupTestRoot({ container, root });
  });
});
