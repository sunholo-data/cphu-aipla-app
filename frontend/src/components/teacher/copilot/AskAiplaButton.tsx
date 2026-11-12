"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { BookOpen, ChevronDown, HelpCircle, Sparkles } from "lucide-react";

import { useCopilotEntry } from "./CopilotEntryContext";
import { useT } from "@/i18n";

/** 1.1.108 M4 — copy lives in messages/{da,en}/teacher-shell.json, never inline. */

/**
 * The header's one "Hjælp ▾" menu (UI sweep 2026-11-11).
 *
 * It holds every way to get help on a teacher page:
 *   - **Vejledninger** — the how-to guides (`/guides`). Always present, so the
 *     menu renders on every teacher page even with the help flag off and no
 *     page co-pilot. Guides used to be a nav destination; they are reference
 *     material, not a place a teacher goes every session.
 *   - **Spørg AIPLA Hjælp** — the help co-pilot, only when `aiplaHelp` is on.
 *   - **the page's work co-pilot** (class list, class page, builder, tutors),
 *     when one registered with the `CopilotEntryProvider` (1.1.125 M3). Since
 *     2026-11-12 the co-pilot's own pill shows in the shell as well — teachers
 *     did not find it here alone — and this item stays as the second way in.
 *
 * Radix, not a hand-rolled list: the old `role="menu"` had no arrow keys, no
 * focus on open and did not return focus on Esc (audit, shell f).
 */
export function AskAiplaButton({ helpEnabled, onOpenHelp }: { helpEnabled: boolean; onOpenHelp: () => void }) {
  const t = useT("AskAiplaButton");
  const entry = useCopilotEntry();
  const page = entry?.registered ?? null;

  const itemCls =
    "flex cursor-pointer items-start gap-2 rounded-md px-2.5 py-2 text-left outline-none data-[highlighted]:bg-muted";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        data-testid="ask-aipla"
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t("button")}</span>
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          aria-label={t("menu")}
          className="z-50 w-72 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
        >
          <DropdownMenu.Item asChild className={itemCls}>
            <Link href="/guides" data-testid="help-menu-guides">
              <BookOpen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex flex-col">
                <span className="font-medium">{t("guides")}</span>
                <span className="text-xs text-muted-foreground">{t("guidesHint")}</span>
              </span>
            </Link>
          </DropdownMenu.Item>
          {helpEnabled ? (
            <DropdownMenu.Item className={itemCls} onSelect={onOpenHelp} data-testid="help-menu-assistant">
              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex flex-col">
                <span className="font-medium">{t("help")}</span>
                <span className="text-xs text-muted-foreground">{t("helpHint")}</span>
              </span>
            </DropdownMenu.Item>
          ) : null}
          {page ? (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item className={itemCls} onSelect={() => page.open()} data-testid="help-menu-copilot">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="flex flex-col">
                  <span className="font-medium">{page.title}</span>
                  <span className="text-xs text-muted-foreground">{t("copilotHint")}</span>
                </span>
              </DropdownMenu.Item>
            </>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
