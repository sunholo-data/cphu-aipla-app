import type { Metadata } from "next";

import { ProjectHeader } from "@/components/project/ProjectHeader";
import { ProjectMobileNav, ProjectSidebar } from "@/components/project/ProjectSidebar";

export const metadata: Metadata = {
  title: {
    default: "AIPLA project",
    template: "%s — AIPLA",
  },
  description: "Research, activities, and project information for AI in Physics Learning and Assessment at the University of Copenhagen.",
};

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <ProjectHeader />
      <ProjectMobileNav />
      <div className="mx-auto flex max-w-7xl">
        <ProjectSidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
