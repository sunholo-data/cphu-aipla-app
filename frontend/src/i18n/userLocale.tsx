"use client";

// 1.1.108 — the PERSON's language, as opposed to the STUDENTS' language.
//
//   user locale     — what this person reads the app in. Chosen with the
//                     DA | EN switch, remembered in this browser. Governs every
//                     surface that is not inside an activity: join page, lesson
//                     picker, footer, teacher screens (as M2 translates them).
//   activity locale — what the students of an activity read and the tutor
//                     speaks. Set by the teacher on the activity; wins inside
//                     it, whatever the viewer's own setting (a teacher working
//                     in English still previews a Danish activity in Danish).
//
// Neither is guessed from the browser (rule M4.3): no setting → the site
// default. localStorage because this is a per-browser preference, every access
// guarded — storage can be absent or throw.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { LocaleProvider } from "./index";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "./locale";

export const USER_LOCALE_KEY = "aipla.uiLocale";

function readStored(): Locale | null {
  try {
    const v = typeof localStorage === "undefined" ? null : localStorage.getItem(USER_LOCALE_KEY);
    return (LOCALES as readonly string[]).includes(v ?? "") ? (v as Locale) : null;
  } catch {
    return null;
  }
}

interface UserLocaleValue {
  /** The locale in force for this person: their choice, else the site default. */
  locale: Locale;
  /** True once the person has chosen — lets the lesson picker prefer the class's
   *  language for someone who never said. */
  explicit: boolean;
  setLocale: (locale: Locale) => void;
}

const UserLocaleContext = createContext<UserLocaleValue>({
  locale: DEFAULT_LOCALE,
  explicit: false,
  setLocale: () => {},
});

export function UserLocaleProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Locale | null>(null);

  useEffect(() => {
    setStored(readStored());
    // Another tab changed it — follow, so two tabs never disagree.
    const onStorage = (e: StorageEvent) => {
      if (e.key === USER_LOCALE_KEY) setStored(readStored());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setLocale = useCallback((next: Locale) => {
    try {
      localStorage.setItem(USER_LOCALE_KEY, next);
    } catch {
      /* not persisted — still applies for this page view */
    }
    setStored(next);
  }, []);

  const value = useMemo<UserLocaleValue>(
    () => ({ locale: stored ?? DEFAULT_LOCALE, explicit: stored !== null, setLocale }),
    [stored, setLocale],
  );

  return (
    <UserLocaleContext.Provider value={value}>
      <LocaleProvider locale={value.locale} syncHtmlLang>
        {children}
      </LocaleProvider>
    </UserLocaleContext.Provider>
  );
}

export function useUserLocale(): UserLocaleValue {
  return useContext(UserLocaleContext);
}
