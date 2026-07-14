"use client";

import { type ComponentType, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, ClipboardList, Microscope, PanelLeftClose, PanelLeftOpen, Settings, Users } from "lucide-react";

import { cn } from "@/lib/utils";
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
 * The four teacher destinations. Insights is the home for the analytics
 * surfaces (Overview / Reports), so it stays active across `/insights` and
 * `/reports`. (The standalone `/teacher/analytics` chat was retired in favour
 * of the floating co-pilots, so it's no longer a match prefix.)
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
  match: ["/teacher/research"],
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
  const destinations = isResearcher ? [...DESTINATIONS, RESEARCH_DESTINATION] : DESTINATIONS;
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
