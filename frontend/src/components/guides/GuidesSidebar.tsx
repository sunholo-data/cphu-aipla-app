import { type GuideNavLink, GuidesNavLinks } from "@/components/guides/GuidesNavLinks";
import { guidesFor } from "@/lib/guidesContent";

/**
 * The section rail for /guides — the same furniture /project has, for the same
 * reason: a reader landing on one guide should be able to see the others
 * without going back to an index.
 */
function links(): GuideNavLink[] {
  const sections: { title: string; audience: "teacher" | "student" | "researcher" }[] = [
    { title: "For teachers", audience: "teacher" },
    { title: "For students", audience: "student" },
    { title: "For researchers", audience: "researcher" },
  ];
  return [
    { href: "/guides", title: "All guides" },
    ...sections.flatMap(({ title, audience }) => {
      const guides = guidesFor(audience);
      if (guides.length === 0) return [];
      return [
        { href: `#${audience}`, title, heading: true },
        ...guides.map((guide) => ({
          href: `/guides/${guide.slug}`,
          title: guide.title,
          tag: guide.tag,
        })),
      ];
    }),
  ];
}

export function GuidesMobileNav() {
  return (
    <nav
      aria-label="Guides"
      className="border-b border-border bg-muted/40 px-4 py-3 lg:hidden print:hidden"
    >
      <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto">
        <GuidesNavLinks links={links()} variant="mobile" />
      </div>
    </nav>
  );
}

export function GuidesSidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border lg:block print:hidden">
      <nav aria-label="Guides" className="sticky top-0 space-y-1 p-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Guides
        </p>
        <GuidesNavLinks links={links()} variant="desktop" />
        <div className="mt-6 border-t border-border pt-5">
          <p className="px-3 text-xs leading-5 text-muted-foreground">
            Teacher and student guides are also available in Danish — open a
            guide and switch language at the top.
          </p>
        </div>
      </nav>
    </aside>
  );
}
