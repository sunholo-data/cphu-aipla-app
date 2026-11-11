"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, FlaskConical, Languages, LogOut, Settings, UserRound } from "lucide-react";

import { LOCALES, useT } from "@/i18n";
import type { Locale } from "@/i18n/locale";
import { useUserLocale } from "@/i18n/userLocale";

/**
 * The account menu (1.1.125 M0; reshaped in the UI sweep 2026-11-11).
 *
 * Holds what left the nav and the header:
 *   - **Tutorer** — first item. Was "Tilgange"; for a teacher the page behind
 *     it (`/teacher/research/frameworks`) is mostly tutors and faces, and the
 *     class page's Tutor setting points at the same idea.
 *   - **Indstillinger**, **Sprog DA | EN** (this browser), **Log ud**.
 *   - the **role line** ("Rolle: forsker"), which replaced the header's
 *     "Forsker" pill. A small flask on the trigger keeps the role visible on
 *     every page without opening the menu; `ActingForOwnerBanner` still says
 *     so at the moment it matters (editing someone else's class or activity).
 *
 * Radix: arrow keys, Home/End, focus on open and focus back to the trigger on
 * Esc — the hand-rolled `role="menu"` it replaces had none of them, and its
 * language switch sat outside the menu's items. The language is now a
 * `menuitemradio` pair.
 */
export function AccountMenu({
  label,
  avatar,
  onSignOut,
  isResearcher = false,
  isProgrammeAdmin = false,
}: {
  /** The accessible identity — the email leads (see the shell's reasoning). */
  label: string;
  avatar: React.ReactNode;
  onSignOut: () => void;
  isResearcher?: boolean;
  isProgrammeAdmin?: boolean;
}) {
  const t = useT("AccountMenu");
  const tLang = useT("LanguageSwitch");
  const { locale, setLocale } = useUserLocale();

  const role =
    isResearcher && isProgrammeAdmin
      ? t("roleBoth")
      : isResearcher
        ? t("roleResearcher")
        : isProgrammeAdmin
          ? t("roleProgrammeAdmin")
          : null;

  const itemCls =
    "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 outline-none data-[highlighted]:bg-muted";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={t("open")}
        title={label}
        className="flex min-w-0 items-center gap-2 rounded border border-transparent px-1 py-0.5 hover:border-border hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="relative">
          {avatar}
          {isResearcher ? (
            <span
              data-testid="account-role-marker"
              title={t("roleHint")}
              className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-background bg-brand text-brand-foreground"
            >
              <FlaskConical className="h-2.5 w-2.5" aria-hidden="true" />
            </span>
          ) : null}
        </span>
        <span className="sr-only">
          {t("signedInAs", { label })}
          {role ? `. ${t("role", { role })}` : ""}
        </span>
        <span aria-hidden="true" className="hidden max-w-[14rem] truncate text-[11px] text-muted-foreground md:block">
          {label}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          aria-label={t("open")}
          className="z-50 w-64 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
        >
          <DropdownMenu.Label className="flex flex-col gap-0.5 px-2.5 py-2 text-xs text-muted-foreground">
            <span className="truncate">{label}</span>
            {role ? (
              <span data-testid="account-role" className="font-semibold text-brand">
                {t("role", { role })}
              </span>
            ) : null}
          </DropdownMenu.Label>
          <DropdownMenu.Item asChild className={itemCls}>
            <Link href="/teacher/research/frameworks">
              <UserRound className="h-4 w-4" aria-hidden="true" />
              {t("tutors")}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild className={itemCls}>
            <Link href="/teacher/settings">
              <Settings className="h-4 w-4" aria-hidden="true" />
              {t("settings")}
            </Link>
          </DropdownMenu.Item>
          {/* 1.1.108 — the teacher's OWN language, remembered in this browser.
              Not the students': that is each activity's language setting. */}
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <Languages className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span id="account-menu-language" className="flex-1 text-muted-foreground">
              {t("language")}
            </span>
            <DropdownMenu.RadioGroup
              aria-labelledby="account-menu-language"
              value={locale}
              onValueChange={(v) => setLocale(v as Locale)}
              className="inline-flex overflow-hidden rounded border border-border text-xs"
            >
              {LOCALES.map((l) => (
                <DropdownMenu.RadioItem
                  key={l}
                  value={l}
                  lang={l}
                  aria-label={tLang(l)}
                  // Keep the menu open: the change is visible at once, and the
                  // teacher may want the other item next.
                  onSelect={(e) => e.preventDefault()}
                  className="cursor-pointer px-2 py-0.5 font-medium uppercase text-muted-foreground outline-none data-[highlighted]:bg-muted data-[state=checked]:bg-foreground data-[state=checked]:text-background"
                >
                  {l}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={itemCls} onSelect={onSignOut}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {t("signOut")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
