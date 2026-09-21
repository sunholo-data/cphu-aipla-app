"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, LogOut, Settings } from "lucide-react";

/** 1.1.108 M4 — copy lives here, never inline in JSX. */
const copy = {
  open: "Account menu",
  settings: "Settings",
  approaches: "Approaches",
  signOut: "Sign out",
} as const;

/**
 * The account menu (1.1.125 M0): where Settings and Approaches went when they
 * left the nav. Settings was a defaults card and a signpost; Approaches is
 * visited when a class's tutor is chosen, not daily — a nav slot is for the
 * places a teacher goes every session.
 *
 * Approaches is ALSO linked from the class page's Tutor setting; which entry
 * survives is JB/AR's call (1.1.125 decision 1) — shipping both costs a link.
 *
 * Plain button + list rather than a portal menu: it must work in the bottom
 * bar at phone width and in jsdom, and there is nothing here that needs focus
 * trapping.
 */
export function AccountMenu({
  label,
  avatar,
  onSignOut,
}: {
  /** The accessible identity — the email leads (see the shell's reasoning). */
  label: string;
  avatar: React.ReactNode;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={copy.open}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-0 items-center gap-2 rounded border border-transparent px-1 py-0.5 hover:border-border hover:bg-accent"
      >
        {avatar}
        <span className="sr-only">Signed in as {label}</span>
        <span aria-hidden="true" className="hidden max-w-[14rem] truncate text-[11px] text-muted-foreground md:block">
          {label}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {open ? (
        <ul
          role="menu"
          aria-label={copy.open}
          className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded border border-border bg-background py-1 text-sm shadow-lg"
        >
          <li role="none">
            <Link role="menuitem" href="/teacher/settings" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent">
              <Settings className="h-4 w-4" aria-hidden="true" />
              {copy.settings}
            </Link>
          </li>
          <li role="none">
            <Link role="menuitem" href="/teacher/research/frameworks" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent">
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              {copy.approaches}
            </Link>
          </li>
          <li role="none" className="my-1 border-t border-border" />
          <li role="none">
            <button role="menuitem" type="button" onClick={onSignOut} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {copy.signOut}
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
