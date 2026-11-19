import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import en from "./en.json";
import yo from "./yo.json";
import ha from "./ha.json";
import ig from "./ig.json";

/**
 * Small hand-rolled i18n layer for coop-pwa (#406).
 *
 * Deliberately not a library: the whole surface is one `t(key, vars)` call
 * plus `Intl.PluralRules`, both of which are already in the platform. That
 * keeps this app inside scripts/check-bundle-size.mjs's budget without a
 * new runtime dependency.
 *
 * English is the source catalog; every other locale is a partial override
 * keyed the same way. A missing key falls back to English one key at a
 * time, so a catalog can be filled in by a translator at any pace (yo, ha
 * and ig deliberately start empty). Unknown keys fall back to the key
 * itself rather than throwing in production.
 */

export const LOCALES = ["en", "yo", "ha", "ig"] as const;
export type Locale = (typeof LOCALES)[number];

/** BCP-47 tags for Intl. English keeps en-GB so existing date/number output is unchanged. */
export const INTL_LOCALES: Record<Locale, string> = {
  en: "en-GB",
  yo: "yo-NG",
  ha: "ha-NG",
  ig: "ig-NG",
};

export type TranslationKey = keyof typeof en;
export type Catalog = Partial<Record<TranslationKey, string>>;
export type CatalogSet = Record<Locale, Catalog>;
export type TranslationVars = Record<string, string | number | bigint>;

export const catalogs: CatalogSet = { en, yo, ha, ig };

/** Keys that have `.one`/`.other` (and any other plural category) variants. */
export const PLURAL_BASES = ["offline.claimsSummary", "duration.days", "duration.hours"] as const;
export type PluralBaseKey = (typeof PLURAL_BASES)[number];

export type Translate = (key: TranslationKey, vars?: TranslationVars) => string;
export type TranslatePlural = (key: PluralBaseKey, count: number, vars?: TranslationVars) => string;

export const LOCALE_STORAGE_KEY = "harvestlock.locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function hasTranslationKey(key: string): key is TranslationKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

function catalogValue(set: CatalogSet, locale: Locale, key: string): string | undefined {
  return set[locale]?.[key as TranslationKey];
}

/** English source plus any per-locale test overrides, merged key by key. */
function mergeCatalogs(overrides?: Partial<CatalogSet>): CatalogSet {
  if (!overrides) return catalogs;
  return {
    en: { ...catalogs.en, ...(overrides.en ?? {}) },
    yo: { ...catalogs.yo, ...(overrides.yo ?? {}) },
    ha: { ...catalogs.ha, ...(overrides.ha ?? {}) },
    ig: { ...catalogs.ig, ...(overrides.ig ?? {}) },
  };
}

/** Pure translation, exported so non-React helpers and tests can use it directly. */
export function translate(
  locale: Locale,
  key: TranslationKey,
  vars?: TranslationVars,
  set: CatalogSet = catalogs,
): string {
  const template = catalogValue(set, locale, key) ?? catalogValue(set, "en", key) ?? key;
  return interpolate(template, vars);
}

/**
 * Plural lookup via Intl.PluralRules. The target locale decides the
 * category; each candidate key falls back to English independently, so a
 * translator who has only supplied `.other` still gets a complete string.
 */
export function translatePlural(
  locale: Locale,
  key: PluralBaseKey,
  count: number,
  vars?: TranslationVars,
  set: CatalogSet = catalogs,
): string {
  const category = new Intl.PluralRules(INTL_LOCALES[locale]).select(count);
  const formattedCount = new Intl.NumberFormat(INTL_LOCALES[locale]).format(count);
  const allVars: TranslationVars = { count: formattedCount, ...vars };

  for (const candidate of [`${key}.${category}`, `${key}.other`]) {
    const local = catalogValue(set, locale, candidate);
    if (local !== undefined) return interpolate(local, allVars);
    const source = catalogValue(set, "en", candidate);
    if (source !== undefined) return interpolate(source, allVars);
  }
  return interpolate(key, allVars);
}

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
  tPlural: TranslatePlural;
  intlLocale: string;
}

const defaultT: Translate = (key, vars) => translate("en", key, vars);
const defaultTPlural: TranslatePlural = (key, count, vars) => translatePlural("en", key, count, vars);

/**
 * Components rendered in isolation (most component tests) get English
 * rather than a thrown "missing provider" error -- the default locale is
 * the intended behaviour for a bare render, and it keeps every existing
 * component test meaningful without wrapping each one.
 */
const defaultContext: I18nContextValue = {
  locale: "en",
  setLocale: () => {},
  t: defaultT,
  tPlural: defaultTPlural,
  intlLocale: INTL_LOCALES.en,
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : "en";
  } catch {
    // Private browsing / disabled storage is not a reason to break the app.
    return "en";
  }
}

export function I18nProvider({
  children,
  initialLocale,
  catalogs: overrides,
}: {
  children: ReactNode;
  /** Test hook: force a starting locale without touching storage. */
  initialLocale?: Locale;
  /** Test hook: fill in catalog entries without editing the JSON files. */
  catalogs?: Partial<CatalogSet>;
}) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? readStoredLocale());
  const activeCatalogs = useMemo(() => mergeCatalogs(overrides), [overrides]);
  const localeRef = useRef(locale);
  const catalogsRef = useRef(activeCatalogs);

  // Kept in refs so `t`/`tPlural` have a stable identity. Consumers still
  // re-render when `locale` changes (the context value changes), but
  // callbacks that depend on `t` (App's list refresh) don't re-run and
  // refetch just because someone used the language picker.
  localeRef.current = locale;
  catalogsRef.current = activeCatalogs;

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // The in-memory locale still works for this session.
    }
  }, []);

  const t = useCallback<Translate>(
    (key, vars) => translate(localeRef.current, key, vars, catalogsRef.current),
    [],
  );
  const tPlural = useCallback<TranslatePlural>(
    (key, count, vars) => translatePlural(localeRef.current, key, count, vars, catalogsRef.current),
    [],
  );

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t, tPlural, intlLocale: INTL_LOCALES[locale] }),
    [locale, setLocale, t, tPlural],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext) ?? defaultContext;
}
