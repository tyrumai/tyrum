import { createIntl, createIntlCache, type IntlShape } from "react-intl";
import enMessages from "./messages/en.json";
import nlMessages from "./messages/nl.json";

export type SupportedLocale = "en" | "nl";
export type LocaleSetting = "system" | SupportedLocale;
export type LocaleMessages = Readonly<Record<string, string>>;

const EN_MESSAGES = enMessages satisfies Record<string, string>;
const NL_MESSAGES = nlMessages satisfies Record<string, string>;

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ["en", "nl"] as const;

export const SHARED_LOCALE_MESSAGES: Readonly<Record<SupportedLocale, LocaleMessages>> = {
  en: EN_MESSAGES,
  nl: NL_MESSAGES,
};

const intlCache = createIntlCache();
const sharedIntlByLocale = new Map<SupportedLocale, IntlShape>();

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return value === "en" || value === "nl";
}

export function isLocaleSetting(value: unknown): value is LocaleSetting {
  return value === "system" || isSupportedLocale(value);
}

export function normalizeLocaleCandidate(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function resolveSupportedLocale(value: string | null | undefined): SupportedLocale | null {
  const normalized = normalizeLocaleCandidate(value);
  if (!normalized) return null;
  if (isSupportedLocale(normalized)) {
    return normalized;
  }
  const [base] = normalized.split(/[-_]/, 1);
  return isSupportedLocale(base) ? base : null;
}

export function resolveNavigatorLocale(): SupportedLocale {
  if (typeof navigator === "undefined") {
    return "en";
  }
  const languages = Array.isArray(navigator.languages) ? navigator.languages : [];
  for (const candidate of languages) {
    const resolved = resolveSupportedLocale(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return resolveSupportedLocale(navigator.language) ?? "en";
}

export function getDocumentLocale(): SupportedLocale {
  if (typeof document === "undefined") {
    return "en";
  }
  return resolveSupportedLocale(document.documentElement.lang) ?? resolveNavigatorLocale();
}

export function getLocaleDisplayName(
  locale: SupportedLocale,
  displayLocale: SupportedLocale,
): string {
  try {
    return new Intl.DisplayNames([displayLocale], { type: "language" }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}

function buildSharedIntl(locale: SupportedLocale): IntlShape {
  return createIntl(
    {
      locale,
      defaultLocale: "en",
      messages: SHARED_LOCALE_MESSAGES[locale],
    },
    intlCache,
  );
}

export function getSharedIntl(locale: SupportedLocale = getDocumentLocale()): IntlShape {
  const cached = sharedIntlByLocale.get(locale);
  if (cached) {
    return cached;
  }
  const created = buildSharedIntl(locale);
  sharedIntlByLocale.set(locale, created);
  return created;
}

export function formatSharedMessage(
  defaultMessage: string,
  values?: Record<string, string | number | Date | null | undefined>,
  locale: SupportedLocale = getDocumentLocale(),
): string {
  return getSharedIntl(locale).formatMessage(
    {
      id: defaultMessage,
      defaultMessage,
    },
    values,
  );
}
