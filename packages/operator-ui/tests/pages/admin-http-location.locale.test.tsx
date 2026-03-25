// @vitest-environment jsdom

import React, { useMemo } from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_PLACE_DRAFT,
  validatePlaceDraft,
} from "../../src/components/pages/admin-http-location-sections.js";
import { useI18n } from "../../src/i18n-helpers.js";
import { LocaleProvider, useLocale } from "../../src/i18n.js";
import { cleanupTestRoot, renderIntoDocument } from "../test-utils.js";

function stubLocalStorage(): void {
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

describe("admin-http-location locale reactivity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.lang = "";
  });

  it("recomputes memoized place validation when the locale changes", () => {
    stubLocalStorage();
    setNavigatorLocales(["en-US"]);

    const invalidDraft = { ...EMPTY_PLACE_DRAFT, radiusM: "0" };
    let localeApi: ReturnType<typeof useLocale> | null = null;
    let message = "";

    const Probe = () => {
      const intl = useI18n();
      localeApi = useLocale();
      message = useMemo(() => validatePlaceDraft(intl, invalidDraft), [intl, invalidDraft]) ?? "";
      return null;
    };

    const testRoot = renderIntoDocument(
      React.createElement(LocaleProvider, null, React.createElement(Probe, null)),
    );

    try {
      expect(message).toBe("Radius must be greater than zero.");

      act(() => {
        localeApi?.setSetting("nl");
      });

      expect(message).toBe("De straal moet groter zijn dan nul.");
    } finally {
      cleanupTestRoot(testRoot);
    }
  });
});
