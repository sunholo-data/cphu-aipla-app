"use client";

// 1.1.108 M0/M1 — the message layer.
//
// `next-intl` does the ICU work (interpolation, plurals); the locale itself
// comes from a small context of ours rather than next-intl's provider, because:
//
//  - the student's locale is the ACTIVITY's, learned on the client after the
//    config fetch — not the URL's and not the request's (the design rules out
//    path-prefixed locales: a join link must not change shape);
//  - a component rendered with no provider at all (a unit test, the teacher's
//    live preview before it is wrapped) must render Danish, not throw.
//    Graceful degradation over a hard dependency (Axiom 5).
//
// Usage in a component:
//
//     const t = useT("SimLauncher");
//     <span>{t("open", { name: artefact.displayName })}</span>
//
// Keys are typed from `messages/da/*.json`; a typo is a compile error.

import { createTranslator } from "next-intl";
import { createContext, Fragment, useContext, useEffect, useMemo, type ReactNode } from "react";

import { DEFAULT_LOCALE, type Locale, type LocaleMode } from "./locale";
import { MESSAGES, type MessageKey, type Namespace } from "./messages";

export * from "./locale";
export type { MessageKey, Namespace } from "./messages";

const LocaleContext = createContext<LocaleMode>(DEFAULT_LOCALE);

/** What a bilingual surface puts between the two languages — the separator the
 *  join page and lesson picker already used before the message layer. */
export const BILINGUAL_SEPARATOR = " / ";

type Values = Record<string, string | number | Date>;
/** Values for `t.rich`: plain values plus tag renderers, e.g.
 *  `{ code: (chunks) => <code>{chunks}</code> }` for `"… <code>{x}</code> …"`. */
type RichValues = Record<string, string | number | Date | ((chunks: ReactNode) => ReactNode)>;
export interface Translate<N extends Namespace> {
  (key: MessageKey<N>, values?: Values): string;
  /** For a sentence with markup inside it — keeps the sentence whole for the
   *  translator instead of splitting it around a `<code>` or a link. */
  rich(key: MessageKey<N>, values?: RichValues): ReactNode;
}

function translatorFor<N extends Namespace>(locale: Locale, namespace: N): Translate<N> {
  const t = createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace,
    // A key missing from one locale is caught by messages.test.ts in CI; at
    // runtime it degrades to the Danish string, never to a raw key.
    onError: () => {},
    getMessageFallback: ({ key }) => {
      const table = MESSAGES[DEFAULT_LOCALE][namespace] as Record<string, string> | undefined;
      return table?.[key] ?? key;
    },
  }) as unknown as ((key: string, values?: Values) => string) & {
    rich: (key: string, values?: RichValues) => ReactNode;
  };
  const fn = ((key, values) => t(key, values)) as Translate<N>;
  fn.rich = (key, values) => t.rich(key, values);
  return fn;
}

/** Non-hook form for code outside a component (label helpers, tests). */
export function translate<N extends Namespace>(mode: LocaleMode, namespace: N): Translate<N> {
  if (mode === "bilingual") {
    const da = translatorFor("da", namespace);
    const en = translatorFor("en", namespace);
    const fn = ((key, values) => `${da(key, values)}${BILINGUAL_SEPARATOR}${en(key, values)}`) as Translate<N>;
    fn.rich = (key, values) => (
      <Fragment>
        {da.rich(key, values)}
        {BILINGUAL_SEPARATOR}
        {en.rich(key, values)}
      </Fragment>
    );
    return fn;
  }
  return translatorFor(mode, namespace);
}

/** The locale mode in force for this subtree (Danish when no provider). */
export function useLocaleMode(): LocaleMode {
  return useContext(LocaleContext);
}

/** Translator for one namespace. `override` pins a locale for a component that
 *  is handed its language as a prop (e.g. a composer rendered by the page). */
export function useT<N extends Namespace>(namespace: N, override?: LocaleMode | null): Translate<N> {
  const ctx = useContext(LocaleContext);
  const mode = override ?? ctx;
  return useMemo(() => translate(mode, namespace), [mode, namespace]);
}

interface LocaleProviderProps {
  locale: LocaleMode;
  /** Set `<html lang>` while mounted (the root layout hardcodes `en`). Only the
   *  surface that OWNS the page should pass this — not an embedded preview. */
  syncHtmlLang?: boolean;
  children: ReactNode;
}

export function LocaleProvider({ locale, syncHtmlLang = false, children }: LocaleProviderProps) {
  useEffect(() => {
    if (!syncHtmlLang || locale === "bilingual" || typeof document === "undefined") return;
    const el = document.documentElement;
    const previous = el.lang;
    el.lang = locale;
    return () => {
      el.lang = previous;
    };
  }, [locale, syncHtmlLang]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
