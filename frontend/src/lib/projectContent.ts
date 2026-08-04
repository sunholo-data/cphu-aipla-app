import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { slugifyProjectHeading } from "@/lib/projectHeadings";

export interface ProjectPageSummary {
  slug: string;
  title: string;
  description: string;
  eyebrow: string;
}

export interface ProjectHeading {
  id: string;
  title: string;
  level: 2 | 3;
}

export interface ProjectPage extends ProjectPageSummary {
  body: string;
  headings: ProjectHeading[];
}

export const PROJECT_PAGES: readonly ProjectPageSummary[] = [
  {
    slug: "about",
    title: "About AIPLA",
    description: "The project's purpose, approach, partners, and public context.",
    eyebrow: "Project overview",
  },
  {
    slug: "research",
    title: "Research",
    description: "The questions and principles guiding AI-supported physics education.",
    eyebrow: "Questions and method",
  },
  {
    slug: "activities",
    title: "Activities and examples",
    description: "How tutors, simulations, virtual labs, and critical AI use fit together.",
    eyebrow: "In the classroom",
  },
  {
    slug: "progress",
    title: "Project progress",
    description: "A public view of development, teacher collaboration, and next steps.",
    eyebrow: "Current work",
  },
] as const;

function contentPath(slug: string): string {
  return path.join(process.cwd(), "content", "project", `${slug}.md`);
}

function extractHeadings(body: string): ProjectHeading[] {
  return Array.from(body.matchAll(/^(#{2,3})\s+(.+)$/gm), (match) => ({
    id: slugifyProjectHeading(match[2]),
    title: match[2].replace(/[*_`]/g, ""),
    level: match[1].length as 2 | 3,
  }));
}

export function getProjectPage(slug: string): ProjectPage | null {
  const summary = PROJECT_PAGES.find((page) => page.slug === slug);
  if (!summary) return null;

  const body = readFileSync(contentPath(slug), "utf8");
  return { ...summary, body, headings: extractHeadings(body) };
}
