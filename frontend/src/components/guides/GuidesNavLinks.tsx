"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The guide rail's links, with the current guide marked — deliberately the
 * same shape and classes as `ProjectNavLinks`, because /guides and /project
 * are the same kind of surface and used to look like two different products.
 *
 * A Danish guide is reachable from its English twin (the language switch on
 * the page), not listed separately: the rail is a reading order, and showing
 * every guide twice would double it for a reader who only speaks one.
 */
export type GuideNavLink = { href: string; title: string; tag?: string; heading?: boolean };

export function GuidesNavLinks({
  links,
  variant,
}: {
  links: readonly GuideNavLink[];
  variant: "desktop" | "mobile";
}) {
  const pathname = usePathname();

  return links.map((link) => {
    if (link.heading) {
      return variant === "desktop" ? (
        <p
          key={link.title}
          className="mt-5 px-3 pb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground first:mt-0"
        >
          {link.title}
        </p>
      ) : null;
    }

    const isCurrent = pathname === link.href;
    const className = variant === "mobile"
      ? `shrink-0 rounded-full border px-3 py-1.5 text-sm ${
          isCurrent
            ? "border-brand bg-brand font-medium text-white"
            : "border-border bg-background text-muted-foreground hover:text-foreground"
        }`
      : `block rounded-md px-3 py-2 text-sm ${
          isCurrent
            ? "bg-accent font-medium text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`;

    return (
      <Link
        key={link.href}
        href={link.href}
        className={className}
        aria-current={isCurrent ? "page" : undefined}
      >
        {link.tag ? <span className="mr-1.5 font-mono text-xs opacity-70">{link.tag}</span> : null}
        {link.title}
      </Link>
    );
  });
}
