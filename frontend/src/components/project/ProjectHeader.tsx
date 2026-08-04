import Link from "next/link";

import { BRANDING } from "@/lib/branding";

export function ProjectHeader() {
  return (
    <header className="border-b border-border bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/project" className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRANDING.logo.headerMark} alt="" aria-hidden="true" className="h-9 w-9" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight text-foreground">AIPLA</span>
            <span className="hidden truncate text-xs text-muted-foreground sm:block">
              AI in Physics Learning and Assessment
            </span>
          </span>
        </Link>
        <nav aria-label="Project navigation" className="flex items-center gap-1 text-sm">
          <Link href="/guides" className="rounded-md px-3 py-2 text-muted-foreground hover:bg-accent hover:text-foreground">
            Guides
          </Link>
          <Link href="/" className="rounded-md bg-red-800 px-3 py-2 font-medium text-white hover:bg-red-900">
            Open AIPLA
          </Link>
        </nav>
      </div>
    </header>
  );
}
