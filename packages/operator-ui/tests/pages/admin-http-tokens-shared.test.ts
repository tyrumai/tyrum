// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthTokenListEntry } from "@tyrum/operator-app/browser";
import {
  buildUpdateInput,
  formatTimestamp,
  formatAccessSummary,
  formStateFromToken,
} from "../../src/components/pages/admin-http-tokens-shared.js";
import { getSharedIntl } from "../../src/i18n/messages.js";
import { formatDateTime } from "../../src/utils/format-date-time.js";

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.lang = "";
});

describe("admin-http-tokens-shared", () => {
  it("preserves unchanged preset expirations after time passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00.000Z"));

    const token: AuthTokenListEntry = {
      token_id: "preset-token",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      display_name: "Preset token",
      role: "client",
      device_id: "tyrum",
      scopes: ["operator.read"],
      issued_at: "2026-02-01T00:00:00.000Z",
      expires_at: "2026-03-02T00:00:30.000Z",
      revoked_at: null,
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    };

    const initialState = formStateFromToken(token);
    expect(initialState.expirationPreset).toBe("24h");

    vi.setSystemTime(new Date("2026-03-01T00:02:00.000Z"));

    expect(
      buildUpdateInput(
        { ...initialState, displayName: "Preset token renamed" },
        {
          initialExpiresAt: token.expires_at,
          initialExpirationPreset: initialState.expirationPreset,
          initialCustomExpiresAt: initialState.customExpiresAt,
        },
      ),
    ).toEqual({
      display_name: "Preset token renamed",
      role: "client",
      device_id: "tyrum",
      scopes: ["operator.read"],
    });
  });

  it("uses the provided intl for access summaries when document.lang disagrees", () => {
    document.documentElement.lang = "en";

    const token: AuthTokenListEntry = {
      token_id: "scopeless-token",
      tenant_id: "11111111-1111-4111-8111-111111111111",
      display_name: "Scopeless token",
      role: "client",
      device_id: "tyrum",
      scopes: [],
      issued_at: "2026-02-01T00:00:00.000Z",
      expires_at: null,
      revoked_at: null,
      created_at: "2026-02-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    };

    expect(formatAccessSummary(getSharedIntl("nl"), token)).toBe("Geen bereik");
  });

  it("uses the provided intl for timestamps when document.lang disagrees", () => {
    document.documentElement.lang = "en";
    const intl = getSharedIntl("nl");
    const timestamp = "2026-03-02T00:00:30.000Z";

    expect(formatTimestamp(intl, timestamp)).toBe(
      formatDateTime(timestamp, undefined, intl.locale),
    );
  });
});
