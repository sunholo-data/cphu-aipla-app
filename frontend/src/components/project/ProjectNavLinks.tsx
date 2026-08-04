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
  const links = [{ href: "/project", title: "Overview" }, ...pages.map((page) => ({
    href: `/project/${page.slug}`,
    title: page.title,
  }))];

  return links.map((link) => {
    const isActive = pathname === link.href || (link.href !== "/project" && pathname.startsWith(`${link.href}/`));
    const className = variant === "mobile"
      ? `shrink-0 rounded-full border px-3 py-1.5 text-sm ${
          isActive
            ? "border-red-800 bg-red-800 font-medium text-white"
            : "border-border bg-background text-muted-foreground hover:text-foreground"
        }`
      : `block rounded-md px-3 py-2 text-sm ${
          isActive
            ? "bg-accent font-medium text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
        }`;

    return (
      <Link key={link.href} href={link.href} className={className} aria-current={isActive ? "page" : undefined}>
        {link.title}
      </Link>
    );
  });
}
