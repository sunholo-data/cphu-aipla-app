"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ClipboardList, Settings, Users } from "lucide-react";

import { cn } from "@/lib/utils";

interface Destination {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  /** Path prefixes that mark this destination active. */
  match: string[];
}

/**
 * The four teacher destinations. Insights is the single home for the
 * analytics surfaces (Overview / Ask-the-data / Reports), so it stays active
 * across `/insights`, `/analytics`, and `/reports`.
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
    match: ["/teacher/insights", "/teacher/analytics", "/teacher/reports"],
  },
  { href: "/teacher/settings", label: "Settings", icon: Settings, match: ["/teacher/settings"] },
];

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

  return (
    <>
      {/* Desktop: left rail */}
      <nav
        aria-label="Teacher sections"
        className="hidden shrink-0 md:flex md:w-52 md:flex-col md:gap-1 md:border-r md:border-border md:py-4 md:pr-3"
      >
        {DESTINATIONS.map((d) => {
          const active = isActive(pathname, d.match);
          const Icon = d.icon;
          return (
            <Link
              key={d.href}
              href={d.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded px-3 py-2 text-sm font-medium",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {d.label}
            </Link>
          );
        })}
      </nav>

      {/* Mobile: bottom bar */}
      <nav
        aria-label="Teacher sections"
        className="fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-border bg-background md:hidden"
      >
        {DESTINATIONS.map((d) => {
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
