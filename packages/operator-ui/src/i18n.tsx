import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { IntlProvider } from "react-intl";
import { useHostApiOptional } from "./host/host-api.js";
import {
  getLocaleDisplayName,
  getSharedIntl,
  isLocaleSetting,
  releaseSharedLocale,
  syncSharedLocale,
  type LocaleMessages,
  type LocaleSetting,
  type SupportedLocale,
  resolveNavigatorLocale,
  SHARED_LOCALE_MESSAGES,
} from "./i18n/messages.js";

type ExtraLocaleMessages = Partial<Record<SupportedLocale, LocaleMessages>>;

export interface LocaleProviderProps {
  children: ReactNode;
  extraMessages?: ExtraLocaleMessages;
}

type LocaleContextValue = {
  locale: SupportedLocale;
  setting: LocaleSetting;
  setSetting: (setting: LocaleSetting) => void;
  languageOptions: ReadonlyArray<{
    value: LocaleSetting;
    label: string;
  }>;
};

const STORAGE_KEY = "tyrum.localeSetting";

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readStoredLocaleSetting(): LocaleSetting | null {
  try {
    if (typeof localStorage?.getItem !== "function") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    return isLocaleSetting(raw) ? raw : null;
  } catch {
    return null;
  }
}

function persistStoredLocaleSetting(setting: LocaleSetting): void {
  try {
    if (typeof localStorage?.setItem !== "function") return;
    localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    // Ignore storage failures and keep the in-memory preference.
  }
}

function resolveLocaleFromSetting(setting: LocaleSetting): SupportedLocale {
  return setting === "system" ? resolveNavigatorLocale() : setting;
}

function mergeMessages(
  locale: SupportedLocale,
  extraMessages?: ExtraLocaleMessages,
): Record<string, string> {
  return {
    ...SHARED_LOCALE_MESSAGES[locale],
    ...extraMessages?.[locale],
  };
}

export function LocaleProvider({
  children,
  extraMessages,
}: LocaleProviderProps): React.ReactElement {
  const localeOwner = useMemo(() => Symbol("locale-provider"), []);
  const host = useHostApiOptional();
  const desktopApi = host?.kind === "desktop" ? host.api : null;
  const [setting, setSetting] = useState<LocaleSetting>(
    () => readStoredLocaleSetting() ?? "system",
  );

  useEffect(() => {
    if (!desktopApi) return;
    let cancelled = false;
    void desktopApi
      .getConfig()
      .then((cfg) => {
        if (cancelled) return;
        if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
          return;
        }
        const localeConfig = (cfg as Record<string, unknown>)["locale"];
        if (!localeConfig || typeof localeConfig !== "object" || Array.isArray(localeConfig)) {
          return;
        }
        const nextSetting = (localeConfig as Record<string, unknown>)["setting"];
        if (isLocaleSetting(nextSetting)) {
          setSetting(nextSetting);
        }
      })
      .catch(() => {
        // Ignore desktop config read failures and keep the current locale setting.
      });
    return () => {
      cancelled = true;
    };
  }, [desktopApi]);

  const locale = useMemo<SupportedLocale>(() => resolveLocaleFromSetting(setting), [setting]);
  syncSharedLocale(localeOwner, locale);

  useEffect(
    () => () => {
      releaseSharedLocale(localeOwner);
    },
    [localeOwner],
  );

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const setSettingAndPersist = useCallback(
    (nextSetting: LocaleSetting) => {
      setSetting(nextSetting);
      if (desktopApi) {
        void desktopApi.setConfig({ locale: { setting: nextSetting } });
        return;
      }
      persistStoredLocaleSetting(nextSetting);
    },
    [desktopApi],
  );

  const languageOptions = useMemo(() => {
    const intl = getSharedIntl(locale);
    return [
      {
        value: "system" as const,
        label: intl.formatMessage(
          {
            id: "System default ({locale})",
            defaultMessage: "System default ({locale})",
          },
          { locale: getLocaleDisplayName(locale, locale) },
        ),
      },
      {
        value: "en" as const,
        label: getLocaleDisplayName("en", locale),
      },
      {
        value: "nl" as const,
        label: getLocaleDisplayName("nl", locale),
      },
    ];
  }, [locale]);

  const contextValue = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setting,
      setSetting: setSettingAndPersist,
      languageOptions,
    }),
    [locale, setting, setSettingAndPersist, languageOptions],
  );

  return createElement(
    LocaleContext.Provider,
    { value: contextValue },
    createElement(
      IntlProvider,
      {
        locale,
        defaultLocale: "en",
        messages: mergeMessages(locale, extraMessages),
      },
      children,
    ),
  );
}

export function useLocale(): LocaleContextValue {
  const value = useLocaleOptional();
  if (!value) {
    throw new Error("useLocale must be used within a LocaleProvider.");
  }
  return value;
}

export function useLocaleOptional(): LocaleContextValue | null {
  return useContext(LocaleContext);
}
