"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Coins } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsResearcher } from "@/hooks/useIsResearcher";

/**
 * Sub-navigation for the Insights area (1.1.26 P5). The "Ask the data" tab
 * (the standalone /teacher/analytics chat) was retired in favour of the
 * floating teacher co-pilots — per-class analytics lives on each class page,
 * cross-class on the manage-class hub co-pilot (/teacher/classes). Per-group
 * Reports stay a leaf reached from a group row.
 *
 * What remains: Overview (cross-class KPIs) plus the researcher-only Cost tab
 * (1.1.9) — cross-class spend gated on the researcher claim (1.1.5). With only
 * Overview for a non-researcher there's a single destination, so the bar hides
 * itself (nothing to switch between).
 */
const TABS = [{ href: "/teacher/insights", label: "Overview", icon: BarChart3 }];

const RESEARCHER_TABS = [{ href: "/teacher/insights/cost", label: "Cost", icon: Coins }];

export function InsightsTabs() {
  const pathname = usePathname() ?? "";
  const isResearcher = useIsResearcher();
  const tabs = isResearcher ? [...TABS, ...RESEARCHER_TABS] : TABS;

  // A single destination needs no tab bar — nothing to switch between.
  if (tabs.length <= 1) return null;

  return (
    <nav aria-label="Insights views" className="flex items-center gap-1 border-b border-border">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
