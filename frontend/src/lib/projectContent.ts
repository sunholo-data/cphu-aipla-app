import "server-only";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { slugifyProjectHeading } from "@/lib/projectHeadings";

export type ProjectContentStatus = "Current" | "Provisional" | "Historical";

export interface ProjectPageSummary {
  slug: string;
  title: string;
  description: string;
  eyebrow: string;
  owner: string;
  reviewed: string;
  reviewBy: string;
  status: ProjectContentStatus;
  order: number;
  nav: boolean;
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

const CONTENT_ROOT = path.join(process.cwd(), "content", "project");

function markdownFiles(directory: string, prefix = ""): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(absolute, relative);
    return entry.isFile() && entry.name.endsWith(".md") ? [relative] : [];
  });
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseMarkdown(relativePath: string): ProjectPage {
  const raw = readFileSync(path.join(CONTENT_ROOT, relativePath), "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Project content is missing front matter: ${relativePath}`);

  const fields = Object.fromEntries(
    match[1]
      .split("\n")
      .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator < 1) throw new Error(`Invalid project front matter in ${relativePath}: ${line}`);
        return [line.slice(0, separator).trim(), unquote(line.slice(separator + 1))];
      }),
  );

  const required = ["title", "description", "eyebrow", "owner", "reviewed", "reviewBy", "status", "order", "nav"];
  for (const key of required) {
    if (!fields[key]) throw new Error(`Project content is missing '${key}': ${relativePath}`);
  }

  if (!(["Current", "Provisional", "Historical"] as string[]).includes(fields.status)) {
    throw new Error(`Invalid project content status '${fields.status}': ${relativePath}`);
  }

  const body = match[2].trim();
  const slug = relativePath.replace(/\.md$/, "");
  return {
    slug,
    title: fields.title,
    description: fields.description,
    eyebrow: fields.eyebrow,
    owner: fields.owner,
    reviewed: fields.reviewed,
    reviewBy: fields.reviewBy,
    status: fields.status as ProjectContentStatus,
    order: Number(fields.order),
    nav: fields.nav === "true",
    body,
    headings: extractHeadings(body),
  };
}

function extractHeadings(body: string): ProjectHeading[] {
  return Array.from(body.matchAll(/^(#{2,3})\s+(.+)$/gm), (match) => ({
    id: slugifyProjectHeading(match[2]),
    title: match[2].replace(/[*_`]/g, ""),
    level: match[1].length as 2 | 3,
  }));
}

export const PROJECT_ALL_PAGES: readonly ProjectPage[] = markdownFiles(CONTENT_ROOT)
  .map(parseMarkdown)
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

export const PROJECT_PAGES: readonly ProjectPageSummary[] = PROJECT_ALL_PAGES
  .filter((page) => page.nav)
  .map(({ body: _body, headings: _headings, ...summary }) => summary);

export function getProjectPage(slug: string): ProjectPage | null {
  return PROJECT_ALL_PAGES.find((page) => page.slug === slug) ?? null;
}

export function getProjectSiblings(page: ProjectPage): {
  previous: ProjectPageSummary | null;
  next: ProjectPageSummary | null;
} {
  const collection = page.nav
    ? PROJECT_PAGES
    : PROJECT_ALL_PAGES.filter((candidate) => candidate.slug.startsWith(`${page.slug.split("/")[0]}/`));
  const index = collection.findIndex((candidate) => candidate.slug === page.slug);
  return {
    previous: index > 0 ? collection[index - 1] : null,
    next: index >= 0 && index < collection.length - 1 ? collection[index + 1] : null,
  };
}
