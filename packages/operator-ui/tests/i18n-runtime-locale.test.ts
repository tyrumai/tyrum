// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useIntl } from "react-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "../src/i18n.js";
import { formatSharedMessage } from "../src/i18n/messages.js";
import { formatDateTime } from "../src/utils/format-date-time.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createTestRoot() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
}

function setNavigatorLocales(languages: string[], language = languages[0] ?? "en-US"): void {
  Object.defineProperty(window.navigator, "languages", {
    configurable: true,
    value: languages,
  });
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    value: language,
  });
}

describe("runtime locale fallback helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.lang = "";
  });

  it("keeps shared message and date formatters aligned with the active locale", () => {
    const { container, root } = createTestRoot();
    stubLocalStorage();
    setNavigatorLocales(["en-US"]);

    const timestamp = "2026-01-15T12:00:00.000Z";
    const enTimestamp = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
    const nlTimestamp = new Intl.DateTimeFormat("nl", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));

    let switchLocale: ((setting: "en" | "nl" | "system") => void) | null = null;
    let contextLabel = "";
    let sharedLabel = "";
    let formattedTimestamp = "";

    const Probe = () => {
      const locale = useLocale();
      const intl = useIntl();
      switchLocale = locale.setSetting;
      contextLabel = intl.formatMessage({ id: "Language", defaultMessage: "Language" });
      sharedLabel = formatSharedMessage("Admin access");
      formattedTimestamp = formatDateTime(timestamp);
      return null;
    };

    act(() => {
      root.render(React.createElement(LocaleProvider, null, React.createElement(Probe, null)));
    });

    expect(contextLabel).toBe("Language");
    expect(sharedLabel).toBe("Admin access");
    expect(formattedTimestamp).toBe(enTimestamp);

    act(() => {
      switchLocale?.("nl");
    });

    expect(contextLabel).toBe("Taal");
    expect(sharedLabel).toBe("Beheerderstoegang");
    expect(formattedTimestamp).toBe(nlTimestamp);
    expect(document.documentElement.lang).toBe("nl");

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
