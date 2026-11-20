import { LOCALES, useI18n, type Locale, type TranslationKey } from "../i18n";

const LANGUAGE_KEYS: Record<Locale, TranslationKey> = {
  en: "language.en",
  yo: "language.yo",
  ha: "language.ha",
  ig: "language.ig",
};

/**
 * Persisted language picker (#406). Options are endonyms so a speaker can
 * find their language without already reading the current UI language.
 */
export function LanguagePicker() {
  const { locale, setLocale, t } = useI18n();

  return (
    <select
      className="language-picker"
      aria-label={t("language.label")}
      value={locale}
      onChange={(event) => {
        const next = event.target.value;
        if ((LOCALES as readonly string[]).includes(next)) setLocale(next as Locale);
      }}
    >
      {LOCALES.map((option) => (
        <option key={option} value={option}>
          {t(LANGUAGE_KEYS[option])}
        </option>
      ))}
    </select>
  );
}
