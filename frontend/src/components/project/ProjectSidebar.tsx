import { ProjectNavLinks } from "@/components/project/ProjectNavLinks";
import { PROJECT_PAGES } from "@/lib/projectContent";

export function ProjectMobileNav() {
  return (
    <nav aria-label="Project sections" className="border-b border-border bg-muted/40 px-4 py-3 lg:hidden">
      <div className="mx-auto flex max-w-7xl gap-2 overflow-x-auto">
        <ProjectNavLinks pages={PROJECT_PAGES} variant="mobile" />
      </div>
    </nav>
  );
}

export function ProjectSidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border lg:block">
      <nav aria-label="Project sections" className="sticky top-0 space-y-1 p-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Project</p>
        <ProjectNavLinks pages={PROJECT_PAGES} variant="desktop" />
        <div className="mt-6 border-t border-border pt-5">
          <p className="px-3 text-xs leading-5 text-muted-foreground">
            University of Copenhagen<br />Department of Science Education
          </p>
        </div>
      </nav>
    </aside>
  );
}
