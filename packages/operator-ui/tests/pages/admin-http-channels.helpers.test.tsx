// @vitest-environment jsdom

import React from "react";
import { TyrumHttpClientError } from "@tyrum/client/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChannelFieldSections } from "../../src/components/pages/admin-http-channels-dialog-fields.js";
import {
  buildConfigPayload,
  buildInitialFormState,
  buildSecretPayload,
  clearChannelFieldError,
  getFieldOptions,
  loadAgentOptions,
  readChannelFieldErrors,
  renderConfiguredBadges,
  renderFieldHelper,
  shouldShowField,
  type AgentOption,
  type ChannelFieldErrors,
} from "../../src/components/pages/admin-http-channels-shared.js";
import { renderIntoDocument, cleanupTestRoot, click, setNativeValue } from "../test-utils.js";
import { createAdminHttpTestCore } from "./admin-page.http-fixture-support.js";

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function getRegistryEntryByChannel(
  core: ReturnType<typeof createAdminHttpTestCore>["core"],
  channel: string,
) {
  return core.http.channelConfig.listRegistry().then((result) => {
    const entry = result.channels.find((candidate) => candidate.channel === channel);
    if (!entry) {
      throw new Error(`missing channel entry ${channel}`);
    }
    return entry;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("admin http channel helpers", () => {
  it("loads agent options and builds channel payloads", async () => {
    const { core } = createAdminHttpTestCore();
    const telegramEntry = await getRegistryEntryByChannel(core, "telegram");
    const agentOptions = await loadAgentOptions(core.http);

    expect(agentOptions).toEqual<AgentOption[]>([
      { key: "default", label: "default" },
      { key: "agent-b", label: "agent-b · Agent B" },
    ]);

    const initialState = buildInitialFormState({
      entry: telegramEntry,
      account: null,
      agentOptions,
    });
    expect(initialState.configValues["pipeline_enabled"]).toBe(true);
    expect(getFieldOptions(telegramEntry.fields[3]!, agentOptions)).toEqual([
      { value: "default", label: "default" },
      { value: "agent-b", label: "agent-b · Agent B" },
    ]);

    const nextState = {
      ...initialState,
      configValues: {
        ...initialState.configValues,
        agent_key: "agent-b",
        allowed_user_ids: "@alice\n123456",
      },
      secretValues: {
        bot_token: "bot-token",
        webhook_secret: "secret",
      },
    };

    expect(buildConfigPayload(telegramEntry, nextState)).toEqual({
      agent_key: "agent-b",
      allowed_user_ids: "@alice\n123456",
      pipeline_enabled: true,
    });
    expect(buildSecretPayload(telegramEntry, nextState)).toEqual({
      bot_token: "bot-token",
      webhook_secret: "secret",
    });
    expect(clearChannelFieldError({ bot_token: ["missing"] }, "bot_token")).toEqual({});
    expect(
      readChannelFieldErrors(
        new TyrumHttpClientError("http_error", "invalid", {
          status: 400,
          error: "invalid_request",
          field_errors: {
            bot_token: ["Bot token is required"],
          },
        }),
      ),
    ).toEqual({
      bot_token: ["Bot token is required"],
    });
    expect(shouldShowField(telegramEntry.fields[0]!, nextState)).toBe(true);
  });

  it("renders field helper text and configured badges", async () => {
    const { core } = createAdminHttpTestCore();
    const registry = await core.http.channelConfig.listRegistry();
    const channels = await core.http.channelConfig.listChannels();
    const telegramEntry = registry.channels.find((entry) => entry.channel === "telegram")!;
    const telegramAccount = channels.channels[0]!.accounts[0]!;

    const helperRoot = renderIntoDocument(
      <div>
        {renderFieldHelper(telegramEntry.fields.find((field) => field.key === "bot_token")!)}
      </div>,
    );
    expect(helperRoot.container.textContent).toContain("How to get a bot token");
    cleanupTestRoot(helperRoot);

    const badgesRoot = renderIntoDocument(
      <div>{renderConfiguredBadges(telegramEntry, telegramAccount)}</div>,
    );
    expect(badgesRoot.container.textContent).toContain("Agent default");
    expect(badgesRoot.container.textContent).toContain("Pipeline enabled");
    expect(badgesRoot.container.textContent).toContain("Bot token configured");
    cleanupTestRoot(badgesRoot);
  });

  it("updates telegram and google chat field state through the extracted field sections", async () => {
    const { core } = createAdminHttpTestCore();
    const registry = await core.http.channelConfig.listRegistry();
    const channels = await core.http.channelConfig.listChannels();
    const telegramEntry = registry.channels.find((entry) => entry.channel === "telegram")!;
    const googleChatEntry = registry.channels.find((entry) => entry.channel === "googlechat")!;
    const telegramAccount = channels.channels[0]!.accounts[1]!;
    const agentOptions = await loadAgentOptions(core.http);

    function Harness({
      entry,
      account,
      initialFieldErrors,
    }: {
      entry: Awaited<ReturnType<typeof core.http.channelConfig.listRegistry>>["channels"][number];
      account:
        | Awaited<
            ReturnType<typeof core.http.channelConfig.listChannels>
          >["channels"][number]["accounts"][number]
        | null;
      initialFieldErrors: ChannelFieldErrors;
    }) {
      const [state, setState] = React.useState(
        buildInitialFormState({
          entry,
          account,
          agentOptions,
        }),
      );
      const [fieldErrors, setFieldErrors] = React.useState(initialFieldErrors);
      const fieldErrorText = (fieldKey: string) => {
        const messages = fieldErrors[fieldKey];
        return messages && messages.length > 0 ? messages.join(" ") : null;
      };
      return (
        <div>
          <ChannelFieldSections
            entry={entry}
            state={state}
            account={account}
            agentOptions={agentOptions}
            fieldErrorText={fieldErrorText}
            setState={setState}
            setFieldErrors={setFieldErrors}
          />
          <pre data-testid="state">{JSON.stringify(state)}</pre>
          <pre data-testid="errors">{JSON.stringify(fieldErrors)}</pre>
        </div>
      );
    }

    const telegramRoot = renderIntoDocument(
      <Harness
        entry={telegramEntry}
        account={telegramAccount}
        initialFieldErrors={{
          bot_token: ["Bot token is required"],
          pipeline_enabled: ["Pipeline toggle failed"],
        }}
      />,
    );
    const botTokenInput = telegramRoot.container.querySelector<HTMLInputElement>(
      "[data-testid='channels-account-field-bot_token']",
    );
    const pipelineSwitch = telegramRoot.container.querySelector<HTMLElement>(
      "[data-testid='channels-account-field-pipeline_enabled']",
    );
    expect(botTokenInput).not.toBeNull();
    expect(pipelineSwitch?.getAttribute("data-state")).toBe("unchecked");
    setNativeValue(botTokenInput!, "bot-token");
    click(pipelineSwitch);
    expect(telegramRoot.container.querySelector("[data-testid='state']")?.textContent).toContain(
      '"bot_token":"bot-token"',
    );
    expect(telegramRoot.container.querySelector("[data-testid='state']")?.textContent).toContain(
      '"pipeline_enabled":true',
    );
    expect(
      telegramRoot.container.querySelector("[data-testid='errors']")?.textContent,
    ).not.toContain("bot_token");
    cleanupTestRoot(telegramRoot);

    const googleChatRoot = renderIntoDocument(
      <Harness
        entry={googleChatEntry}
        account={null}
        initialFieldErrors={{
          auth_method: ["Auth method is required"],
          service_account_json: ["Service account JSON is required"],
        }}
      />,
    );
    const authMethodSelect = googleChatRoot.container.querySelector<HTMLSelectElement>(
      "[data-testid='channels-account-field-auth_method']",
    );
    const filePathInput = googleChatRoot.container.querySelector<HTMLInputElement>(
      "[data-testid='channels-account-field-service_account_file']",
    );
    expect(authMethodSelect?.value).toBe("file_path");
    expect(filePathInput).not.toBeNull();
    setSelectValue(authMethodSelect!, "inline_json");
    const inlineJsonTextarea = googleChatRoot.container.querySelector<HTMLTextAreaElement>(
      "[data-testid='channels-account-field-service_account_json']",
    );
    expect(inlineJsonTextarea).not.toBeNull();
    setNativeValue(inlineJsonTextarea!, '{"type":"service_account"}');
    expect(googleChatRoot.container.querySelector("[data-testid='state']")?.textContent).toContain(
      '"auth_method":"inline_json"',
    );
    expect(
      googleChatRoot.container.querySelector("[data-testid='errors']")?.textContent,
    ).not.toContain("service_account_json");
    cleanupTestRoot(googleChatRoot);
  });
});
