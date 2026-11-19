/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  I18nProvider,
  LOCALE_STORAGE_KEY,
  catalogs,
  translate,
  translatePlural,
  useI18n,
  type TranslationKey,
} from "./index";

function Probe() {
  const { locale, setLocale, t } = useI18n();
  return (
    <>
      <p>{t("app.connectWallet")}</p>
      <p data-testid="locale">{locale}</p>
      <button type="button" onClick={() => setLocale("yo")}>
        {"switch"}
      </button>
    </>
  );
}

describe("i18n catalogs", () => {
  it("falls back to English key by key, then to the key itself", () => {
    // yo/ha/ig ship empty on purpose: an untranslated key must still render.
    expect(catalogs.yo).toEqual({});
    expect(translate("yo", "app.connectWallet")).toBe("Connect wallet");
    expect(translate("yo", "no.such.key" as TranslationKey)).toBe("no.such.key");
  });

  it("interpolates variables without touching unrelated braces", () => {
    expect(translate("en", "app.listError", { message: "db down" })).toBe(
      "Unable to load known commitments: db down",
    );
    expect(translate("en", "allocation.errorShareTotal", { total: 10_500 })).toBe(
      "Shares sum to 10500 basis points, over the 10000 (100%) ceiling.",
    );
  });

  it("selects plural forms through Intl.PluralRules", () => {
    expect(translatePlural("en", "offline.claimsSummary", 1)).toBe(
      "1 claim couldn't reach the network and is waiting to retry.",
    );
    expect(translatePlural("en", "offline.claimsSummary", 2)).toBe(
      "2 claims couldn't reach the network and are waiting to retry.",
    );
    expect(translatePlural("en", "duration.days", 1)).toBe("1 day");
    expect(translatePlural("en", "duration.days", 7)).toBe("7 days");
    expect(translatePlural("en", "duration.hours", 1)).toBe("1 hour");
  });

  it("fails when any non-English catalog has a key that en.json does not", () => {
    const englishKeys = new Set(Object.keys(catalogs.en));
    for (const locale of ["yo", "ha", "ig"] as const) {
      for (const key of Object.keys(catalogs[locale])) {
        expect(
          englishKeys.has(key),
          `${locale}.json has "${key}", which is missing from en.json`,
        ).toBe(true);
      }
    }
  });
});

describe("I18nProvider", () => {
  it("switches locale, updates rendered text and <html lang>, and persists the choice", async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider
        initialLocale="en"
        catalogs={{ yo: { "app.connectWallet": "So woleti" } }}
      >
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByText("Connect wallet")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");

    await user.click(screen.getByRole("button", { name: "switch" }));

    expect(screen.getByText("So woleti")).toBeInTheDocument();
    expect(screen.getByTestId("locale")).toHaveTextContent("yo");
    await waitFor(() => expect(document.documentElement.lang).toBe("yo"));
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("yo");
  });

  it("restores a persisted locale on mount", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "ha");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("ha");
    expect(document.documentElement.lang).toBe("ha");
  });

  it("ignores an unsupported stored value and falls back to English", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    expect(document.documentElement.lang).toBe("en");
  });
});

/**
 * The issue's "no user-visible English literals" guard. This catches plain
 * JSX text and the literal attributes a translation would otherwise miss
 * (aria-label/placeholder/title/alt). `react/jsx-no-literals` in
 * .oxlintrc.json is the second line of defence for mixed text/expression
 * children.
 */
describe("component source has no hard-coded UI text", () => {
  const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  function sourceFiles(): string[] {
    const componentsDir = join(srcRoot, "components");
    const componentFiles = readdirSync(componentsDir)
      .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
      .map((file) => join(componentsDir, file));
    return [join(srcRoot, "App.tsx"), ...componentFiles];
  }

  it("has no literal JSX text or literal visible attributes", () => {
    const jsxText: string[] = [];
    const literalAttributes: string[] = [];

    for (const file of sourceFiles()) {
      const relative = file.slice(srcRoot.length + 1);
      const source = stripComments(readFileSync(file, "utf8"));

      for (const match of source.matchAll(/<[^>]*>\s*([A-Za-z][^<>{}]*?)\s*</g)) {
        jsxText.push(`${relative}: ${match[1].trim()}`);
      }
      for (const match of source.matchAll(/(?:aria-label|placeholder|alt|title)="([^"]*[A-Za-z][^"]*)"/g)) {
        literalAttributes.push(`${relative}: ${match[1]}`);
      }
    }

    expect(jsxText).toEqual([]);
    expect(literalAttributes).toEqual([]);
  });
});
