"use client";

import { type ComponentType, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, ClipboardList, Library, Microscope, MessagesSquare, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsProgrammeAdmin } from "@/hooks/useIsProgrammeAdmin";
import { useIsResearcher } from "@/hooks/useIsResearcher";

const COLLAPSE_KEY = "teacher-nav-collapsed";

interface Destination {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  /** Path prefixes that mark this destination active. */
  match: string[];
}

/**
 * The core teacher destinations. Insights is the home for the analytics
 * surfaces (Overview / Reports), so it stays active across `/insights` and
 * `/reports`. (The standalone `/teacher/analytics` chat was retired in favour
 * of the floating co-pilots, so it's no longer a match prefix.)
 *
 * Materials sits next to Activities (1.1.61): the document corpus is the raw
 * material an activity is assembled from, and until it had its own destination
 * the only way to reach it was to open an activity builder.
 */
const DESTINATIONS: Destination[] = [
  { href: "/teacher/classes", label: "Classes", icon: Users, match: ["/teacher/classes"] },
  {
    href: "/teacher/activities",
    label: "Activities",
    icon: ClipboardList,
    match: ["/teacher/activities"],
  },
  {
    href: "/teacher/materials",
    label: "Materials",
    icon: Library,
    match: ["/teacher/materials"],
  },
  {
    href: "/teacher/insights",
    label: "Insights",
    icon: BarChart3,
    match: ["/teacher/insights", "/teacher/reports"],
  },
  { href: "/teacher/settings", label: "Settings", icon: Settings, match: ["/teacher/settings"] },
  { href: "/guides", label: "Guides", icon: BookOpen, match: ["/guides"] },
];

/**
 * Researcher-only destination (1.1.5): the cross-teacher read-only research scan.
 * Appended after the core four when the account carries the `role:researcher`
 * claim — it is a separate place, not a toggle inside the teacher library.
 */
const RESEARCH_DESTINATION: Destination = {
  href: "/teacher/research/activities",
  label: "Research",
  icon: Microscope,
  // Narrowed from "/teacher/research" when Frameworks joined the area (1.1.91):
  // the broader prefix highlighted BOTH entries on the frameworks page.
  match: ["/teacher/research/activities"],
};

/**
 * Teaching approaches (1.1.91 M1; opened to teachers 1.1.110).
 *
 * Two tiers on one screen. A RESEARCHER maintains the seven approaches drawn
 * from the literature. A TEACHER cannot edit those, but owns their own custom
 * approaches — free text they write themselves, which is the one editable thing
 * on this screen for them and the reason the destination is no longer
 * researcher-gated.
 *
 * Labelled "Approaches" rather than "Frameworks": a teacher writing one in
 * their own words is not authoring a framework, and calling it one would make
 * the same overclaim the removed free-text editor did.
 */
const FRAMEWORKS_DESTINATION: Destination = {
  href: "/teacher/research/frameworks",
  label: "Approaches",
  icon: BookOpen,
  match: ["/teacher/research/frameworks"],
};

/**
 * Researcher-only destination (1.1.109): every conversation, grouped by the
 * teaching approach that produced it, with the transcript one click away.
 *
 * A sibling of Frameworks rather than a tab inside it, for the same reason
 * Frameworks is a sibling of Research: "what was the tutor told to do" and
 * "what did students actually say to it" are different questions, and the
 * second one is the evidence the first is judged by.
 */
const CHAT_LOGS_DESTINATION: Destination = {
  href: "/teacher/research/logs",
  label: "Conversations",
  icon: MessagesSquare,
  match: ["/teacher/research/logs"],
};

/**
 * Delegated-administration destination (PROGADMIN-1 — 1.1.76): the access
 * register and the request queue. Shown to a researcher (read-only) OR a
 * programme admin (read + write) — the union, because the two claims share one
 * surface at different privilege levels.
 *
 * NOT nested under /teacher/research: a programme admin is not necessarily a
 * researcher, and filing an admin surface under "research" would make the
 * naming lie about who it is for.
 */
const PROGRAMME_DESTINATION: Destination = {
  href: "/teacher/programme",
  label: "Programme",
  icon: ShieldCheck,
  match: ["/teacher/programme"],
};

function isActive(pathname: string, match: string[]): boolean {
  return match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

/**
 * Primary teacher navigation — by breakpoint (decision 2026-06-09):
 * a left rail at `≥ md` (laptop) and a bottom bar at `< md` (tablet/phone).
 * Both render the same destinations from one source; only one is visible per
 * viewport. Position:fixed on the bottom bar means its DOM location is
 * irrelevant, so the shell renders this once beside the main content.
 */
export function TeacherNav() {
  const pathname = usePathname() ?? "";
  // Researchers get one extra destination (the cross-teacher Research scan).
  const isResearcher = useIsResearcher();
  const isProgrammeAdmin = useIsProgrammeAdmin();
  const destinations = [
    ...DESTINATIONS,
    // Approaches is for EVERY teacher (1.1.110) — they own the custom tier.
    // Research and Conversations stay researcher-only: both are cross-teacher
    // reads of other people's classes.
    FRAMEWORKS_DESTINATION,
    ...(isResearcher ? [RESEARCH_DESTINATION, CHAT_LOGS_DESTINATION] : []),
    ...(isResearcher || isProgrammeAdmin ? [PROGRAMME_DESTINATION] : []),
  ];
  // Collapse the desktop rail to an icon strip to give app-like surfaces (the
  // activity builder) more room. Persisted so it stays across navigation +
  // refresh. Default expanded (server render); synced from storage on mount.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage unavailable — stay expanded */
    }
  }, []);
  const toggleCollapsed = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  return (
    <>
      {/* Desktop: left rail */}
      <nav
        aria-label="Teacher sections"
        className={cn(
          "hidden shrink-0 md:flex md:flex-col md:gap-1 md:border-r md:border-border md:py-4",
          collapsed ? "md:w-14 md:items-center md:pr-2" : "md:w-52 md:pr-3",
        )}
      >
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={cn(
            "mb-1 flex items-center rounded py-2 text-muted-foreground hover:bg-accent hover:text-foreground",
            collapsed ? "justify-center px-0" : "gap-2 px-3",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          )}
          {!collapsed ? <span className="text-xs font-medium">Collapse</span> : null}
        </button>
        {destinations.map((d) => {
          const active = isActive(pathname, d.match);
          const Icon = d.icon;
          return (
            <Link
              key={d.href}
              href={d.href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? d.label : undefined}
              className={cn(
                "flex items-center rounded text-sm font-medium",
                collapsed ? "justify-center px-0 py-2" : "gap-2 px-3 py-2",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {!collapsed ? d.label : null}
            </Link>
          );
        })}
      </nav>

      {/* Mobile: bottom bar */}
      <nav
        aria-label="Teacher sections"
        className="fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-border bg-background md:hidden"
      >
        {destinations.map((d) => {
          const active = isActive(pathname, d.match);
          const Icon = d.icon;
          return (
            <Link
              key={d.href}
              href={d.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              {d.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
