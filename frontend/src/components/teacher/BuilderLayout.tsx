"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { BookOpen, LayoutGrid, MessageCircle, SlidersHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";

// Activity-builder wayfinding (1.1.40 M2). The builder is one long form; this
// gives it four colour-coded sections that map to the four real concerns a
// teacher configures — so they always know WHERE they are and what each part
// shapes. Nothing is hidden (a non-technical teacher discovers every tool by
// scrolling); the sticky nav + the side-by-side preview do the guiding.

type Accent = "slate" | "violet" | "emerald" | "amber";

// Literal class strings (Tailwind can't see interpolated `bg-${x}-100`).
const ACCENT: Record<Accent, { bar: string; tile: string; chipOn: string; count: string }> = {
  slate: {
    bar: "bg-slate-400",
    tile: "bg-slate-100 text-slate-600",
    chipOn: "border-slate-300 bg-slate-100 text-slate-800",
    count: "bg-slate-200 text-slate-700",
  },
  violet: {
    bar: "bg-violet-400",
    tile: "bg-violet-100 text-violet-600",
    chipOn: "border-violet-300 bg-violet-100 text-violet-800",
    count: "bg-violet-200 text-violet-800",
  },
  emerald: {
    bar: "bg-emerald-400",
    tile: "bg-emerald-100 text-emerald-600",
    chipOn: "border-emerald-300 bg-emerald-100 text-emerald-800",
    count: "bg-emerald-200 text-emerald-800",
  },
  amber: {
    bar: "bg-amber-400",
    tile: "bg-amber-100 text-amber-600",
    chipOn: "border-amber-300 bg-amber-100 text-amber-800",
    count: "bg-amber-200 text-amber-800",
  },
};

export interface BuilderSectionMeta {
  id: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  accent: Accent;
}

export const SECTION = {
  setup: {
    id: "builder-setup",
    label: "Setup",
    hint: "Name it, choose the class, set the language.",
    icon: SlidersHorizontal,
    accent: "slate",
  },
  lesson: {
    id: "builder-lesson",
    label: "Lesson",
    hint: "What the tutor guides students to discover.",
    icon: MessageCircle,
    accent: "violet",
  },
  workspace: {
    id: "builder-workspace",
    label: "Workspace",
    hint: "Add a simulation and the tools students work with.",
    icon: LayoutGrid,
    accent: "emerald",
  },
  materials: {
    id: "builder-materials",
    label: "Materials",
    hint: "Curriculum the tutor can cite — optional.",
    icon: BookOpen,
    accent: "amber",
  },
} satisfies Record<string, BuilderSectionMeta>;

export const BUILDER_SECTIONS: BuilderSectionMeta[] = [
  SECTION.setup,
  SECTION.lesson,
  SECTION.workspace,
  SECTION.materials,
];

/**
 * A colour-accented builder section: a thin accent rule, an icon tile, a title
 * and a one-line hint, then the fields. The accent is the same colour the nav
 * chip uses, so the teacher can map "I'm in the green Workspace section".
 */
export function BuilderSection({
  section,
  children,
}: {
  section: BuilderSectionMeta;
  children: React.ReactNode;
}) {
  const a = ACCENT[section.accent];
  const Icon = section.icon;
  return (
    <section
      id={section.id}
      className="scroll-mt-24 overflow-hidden rounded-lg border border-slate-200 bg-background shadow-sm"
    >
      <div className={cn("h-1 w-full", a.bar)} aria-hidden="true" />
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <span
          className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", a.tile)}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold leading-none text-slate-900">{section.label}</h2>
          <p className="text-xs text-slate-500">{section.hint}</p>
        </div>
      </div>
      <div className="flex flex-col gap-5 px-4 pb-4 pt-4">{children}</div>
    </section>
  );
}

/**
 * Sticky, colour-coded section nav for the builder. Highlights the section the
 * teacher is looking at (scroll-spy) and jumps to one on click. Optional counts
 * surface how much is configured in the additive sections (workspace tools,
 * materials) so nothing useful stays out of sight.
 */
export function BuilderSectionNav({ counts }: { counts?: Partial<Record<string, number>> }) {
  const [active, setActive] = useState<string>(BUILDER_SECTIONS[0].id);

  useEffect(() => {
    // jsdom (tests) has no IntersectionObserver — degrade to the first chip.
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    for (const s of BUILDER_SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const jump = (id: string) => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    setActive(id);
  };

  return (
    <nav
      aria-label="Builder sections"
      className="sticky top-2 z-10 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-background/95 p-1.5 shadow-sm backdrop-blur"
    >
      {BUILDER_SECTIONS.map((s) => {
        const a = ACCENT[s.accent];
        const on = active === s.id;
        const Icon = s.icon;
        const count = counts?.[s.id];
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => jump(s.id)}
            aria-current={on ? "true" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300",
              on ? a.chipOn : "border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {s.label}
            {typeof count === "number" && count > 0 ? (
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1.5 text-[10px] font-semibold leading-tight tabular-nums",
                  on ? a.count : "bg-slate-200 text-slate-600",
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
