"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Coins, MessageCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsResearcher } from "@/hooks/useIsResearcher";

/**
 * Sub-navigation for the Insights area (1.1.26 P5). Unifies the previously
 * separate analytics surfaces into one mental model: Overview (cross-class
 * KPIs, /teacher/insights) and Ask-the-data (the analytics chat,
 * /teacher/analytics). Per-group Reports stay a leaf reached from a group
 * row, so they are not a top-level tab here.
 *
 * The Cost tab (1.1.9) is researcher-only — cross-class spend is a
 * cross-tenant view gated on the researcher claim (1.1.5).
 */
const TABS = [
  { href: "/teacher/insights", label: "Overview", icon: BarChart3 },
  { href: "/teacher/analytics", label: "Ask the data", icon: MessageCircle },
];

const RESEARCHER_TABS = [{ href: "/teacher/insights/cost", label: "Cost", icon: Coins }];

export function InsightsTabs() {
  const pathname = usePathname() ?? "";
  const isResearcher = useIsResearcher();
  const tabs = isResearcher ? [...TABS, ...RESEARCHER_TABS] : TABS;

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
