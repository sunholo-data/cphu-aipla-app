"use client";

// 1.1.108 — the PERSON's language, as opposed to the STUDENTS' language.
//
//   user locale     — what this person reads the app in. Chosen with the
//                     DA | EN switch, remembered in this browser. Governs every
//                     surface that is not inside an activity: join page, lesson
//                     picker, footer, teacher screens (as M2 translates them).
//   activity locale — what the students of an activity read and the tutor
//                     speaks. Set by the teacher on the activity; wins inside
//                     it UNLESS the person has explicitly chosen a language
//                     with the switch (2026-09-30 — see useStudentLanguage).
//
// Neither is guessed from the browser (rule M4.3). No setting → a default
// taken from DATA: English for a researcher (most of the research team do not
// read Danish, and the research content is English — M, 2026-09-30), the site
// default for everyone else. An explicit choice always wins, so a Danish
// researcher switches once and is remembered. localStorage because this is a
// per-browser preference, every access guarded — storage can be absent or throw.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useIsResearcher } from "@/hooks/useIsResearcher";

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
  // The role claim, not the browser: false for students and signed-out visitors.
  const isResearcher = useIsResearcher();

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
    () => ({ locale: stored ?? (isResearcher ? "en" : DEFAULT_LOCALE), explicit: stored !== null, setLocale }),
    [stored, isResearcher, setLocale],
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

/**
 * The language a person has EXPLICITLY chosen with the DA | EN switch, or null
 * when they never chose (2026-09-30).
 *
 * Inside an activity this outranks the activity's language — for the student's
 * screen, the tutor's replies and the read-aloud voice. On 29-30 Sep, English-
 * speaking students in two classes on Danish activities typed "in English" in 9
 * of 13 sessions and the tutor kept drifting back, because every other part of
 * the screen and the prompt was Danish. Null leaves the teacher's choice alone,
 * so a student who never touches the switch sees exactly what they did before.
 */
export function useStudentLanguage(): Locale | null {
  const { locale, explicit } = useUserLocale();
  return explicit ? locale : null;
}
