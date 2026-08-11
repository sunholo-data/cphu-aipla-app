"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type ProjectPageLink = {
  slug: string;
  title: string;
};

type ProjectNavLinksProps = {
  pages: readonly ProjectPageLink[];
  variant: "desktop" | "mobile";
};

export function ProjectNavLinks({ pages, variant }: ProjectNavLinksProps) {
  const pathname = usePathname();
  const links = [{ href: "/project", title: "Overview", depth: 0 }, ...pages.map((page) => ({
    href: `/project/${page.slug}`,
    title: page.title,
    depth: page.slug.split("/").length - 1,
  }))];

  return links.map((link) => {
    const isCurrent = pathname === link.href;
    const containsCurrent = link.href !== "/project" && pathname.startsWith(`${link.href}/`);
    const className = variant === "mobile"
      ? `shrink-0 rounded-full border px-3 py-1.5 text-sm ${
          isCurrent
            ? "border-brand bg-brand font-medium text-white"
            : containsCurrent
              ? "border-brand-line bg-brand-tint font-medium text-foreground"
              : "border-border bg-background text-muted-foreground hover:text-foreground"
        }`
      : `block rounded-md py-2 text-sm ${link.depth ? "ml-3 border-l border-border pl-4 pr-3" : "px-3"} ${
          isCurrent
            ? "bg-accent font-medium text-foreground"
            : containsCurrent
              ? "bg-accent/50 font-medium text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`;

    return (
      <Link key={link.href} href={link.href} className={className} aria-current={isCurrent ? "page" : undefined}>
        {variant === "mobile" && link.depth ? <span aria-hidden="true">↳ </span> : null}
        {link.title}
      </Link>
    );
  });
}
