// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CreateChannelDialog,
  TelegramChannelCard,
} from "../../src/components/pages/admin-http-channel-instance.js";
import type { TelegramChannelConfig } from "../../src/components/pages/admin-http-channels.shared.js";
import { cleanupTestRoot, renderIntoDocument, setNativeValue } from "../test-utils.js";

function createTelegramConfig(
  overrides: Partial<TelegramChannelConfig> = {},
): TelegramChannelConfig {
  return {
    channel: "telegram",
    account_key: "default",
    ingress_mode: "polling",
    bot_token_configured: true,
    webhook_secret_configured: false,
    allowed_user_ids: [],
    pipeline_enabled: true,
    polling_status: "idle",
    polling_last_error_at: null,
    polling_last_error_message: null,
    ...overrides,
  };
}

describe("TelegramChannelCard", () => {
  it("renders webhook fields on the first paint for webhook accounts", () => {
    const markup = renderToStaticMarkup(
      React.createElement(TelegramChannelCard, {
        config: createTelegramConfig({
          ingress_mode: "webhook",
          webhook_secret_configured: true,
          allowed_user_ids: ["123"],
          pipeline_enabled: false,
        }),
        expanded: true,
        onToggle: () => {},
        onUpdated: () => {},
        onDeleted: () => {},
        onChannelConfigsChanged: () => {},
        mutationApi: {
          updateChannelConfig: vi.fn(),
          deleteChannelConfig: vi.fn(),
        } as never,
        canMutate: true,
        requestEnter: () => {},
      }),
    );

    expect(markup).toContain("channels-instance-default-webhook-secret");
    expect(markup).toContain("channels-instance-default-allowed-user-ids");
  });

  it("auto-populates account names in the Telegram create dialog", () => {
    const { container, root } = renderIntoDocument(
      React.createElement(CreateChannelDialog, {
        open: true,
        onOpenChange: () => {},
        onCreated: () => {},
        existingAccountKeys: ["telegram", "telegram-2"],
        mutationApi: {
          createChannelConfig: vi.fn(),
        } as never,
        canMutate: true,
        requestEnter: () => {},
      }),
    );

    const dialog = document.body.querySelector<HTMLElement>(
      "[data-testid='channels-instance-create-dialog']",
    );
    expect(dialog?.textContent).toContain("Account name");

    const input = document.body.querySelector<HTMLInputElement>(
      "[data-testid='channels-instance-create-account-key']",
    );
    expect(input?.value).toBe("telegram-3");

    cleanupTestRoot({ container, root });
  });

  it("preserves manual account name edits across parent rerenders", () => {
    const onOpenChange = () => {};
    const onCreated = () => {};
    const mutationApi = {
      createChannelConfig: vi.fn(),
    } as never;

    const { container, root } = renderIntoDocument(
      React.createElement(CreateChannelDialog, {
        open: true,
        onOpenChange,
        onCreated,
        existingAccountKeys: ["telegram", "telegram-2"],
        mutationApi,
        canMutate: true,
        requestEnter: () => {},
      }),
    );

    const input = document.body.querySelector<HTMLInputElement>(
      "[data-testid='channels-instance-create-account-key']",
    );
    expect(input?.value).toBe("telegram-3");
    if (!input) {
      throw new Error("missing account name input");
    }

    setNativeValue(input, "");

    act(() => {
      root.render(
        React.createElement(CreateChannelDialog, {
          open: true,
          onOpenChange,
          onCreated,
          existingAccountKeys: ["telegram", "telegram-2"],
          mutationApi,
          canMutate: true,
          requestEnter: () => {},
        }),
      );
    });

    expect(
      document.body.querySelector<HTMLInputElement>(
        "[data-testid='channels-instance-create-account-key']",
      )?.value,
    ).toBe("");

    cleanupTestRoot({ container, root });
  });
});
