import "server-only";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { slugifyProjectHeading } from "@/lib/projectHeadings";

/**
 * The how-to guides, as app content (1.1.116).
 *
 * They used to be Quarto documents rendered to self-contained HTML + PDF and
 * served as static files out of `frontend/public/guides/`. That cost us a
 * toolchain nobody had installed (quarto + xelatex — a guide could not be
 * fixed on a laptop without it), and gave the first surface a new teacher is
 * pointed at Bootstrap typography, its own layout and no app chrome.
 *
 * The prose is unchanged; only the front matter and the renderer are new. The
 * loader is deliberately the same shape as `projectContent.ts` — same required
 * fields, same headings extraction — because the two content trees are
 * maintained by the same people with the same review discipline.
 *
 * ⚠️ The PDFs still exist and are still what the corpus seeder ingests, but
 * they are now printed FROM these pages by Playwright (`make guides-pdf`), not
 * built from a parallel source.
 */
export type GuideStatus = "Current" | "Provisional" | "Historical";
export type GuideAudience = "teacher" | "student" | "researcher";
export type GuideLang = "en" | "da";

export interface GuideSummary {
  /** URL slug, e.g. `t1-set-up-a-class` or `t1-set-up-a-class.da`. */
  slug: string;
  /** Slug shared by a guide and its translations, e.g. `t1-set-up-a-class`. */
  baseSlug: string;
  title: string;
  description: string;
  tag: string;
  audience: GuideAudience;
  lang: GuideLang;
  order: number;
  status: GuideStatus;
  owner: string;
  reviewed: string;
  reviewBy: string;
}

export interface GuideHeading {
  id: string;
  title: string;
  level: 2 | 3;
}

export interface Guide extends GuideSummary {
  body: string;
  headings: GuideHeading[];
}

const CONTENT_ROOT = path.join(process.cwd(), "content", "guides");

const AUDIENCES: GuideAudience[] = ["teacher", "student", "researcher"];
const LANGS: GuideLang[] = ["en", "da"];

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

function parseGuide(fileName: string): Guide {
  const raw = readFileSync(path.join(CONTENT_ROOT, fileName), "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Guide is missing front matter: ${fileName}`);

  const fields = Object.fromEntries(
    match[1]
      .split("\n")
      .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator < 1) throw new Error(`Invalid guide front matter in ${fileName}: ${line}`);
        return [line.slice(0, separator).trim(), unquote(line.slice(separator + 1))];
      }),
  );

  const required = [
    "title", "description", "tag", "audience", "order",
    "lang", "status", "owner", "reviewed", "reviewBy",
  ];
  for (const key of required) {
    if (!fields[key]) throw new Error(`Guide is missing '${key}': ${fileName}`);
  }
  if (!AUDIENCES.includes(fields.audience as GuideAudience)) {
    throw new Error(`Invalid guide audience '${fields.audience}': ${fileName}`);
  }
  if (!LANGS.includes(fields.lang as GuideLang)) {
    throw new Error(`Invalid guide lang '${fields.lang}': ${fileName}`);
  }
  if (!(["Current", "Provisional", "Historical"] as string[]).includes(fields.status)) {
    throw new Error(`Invalid guide status '${fields.status}': ${fileName}`);
  }

  const slug = fileName.replace(/\.md$/, "");
  const lang = fields.lang as GuideLang;
  // `<slug>.da.md` is the Danish twin of `<slug>.md` — the shape the
  // localisation rule (1.1.108 M4) asks every content surface to ship in.
  const baseSlug = slug.replace(/\.da$/, "");
  if ((lang === "da") !== slug.endsWith(".da")) {
    throw new Error(`Guide filename and lang disagree: ${fileName} declares lang '${lang}'`);
  }

  const body = match[2].trim();
  return {
    slug,
    baseSlug,
    title: fields.title,
    description: fields.description,
    tag: fields.tag,
    audience: fields.audience as GuideAudience,
    lang,
    order: Number(fields.order),
    status: fields.status as GuideStatus,
    owner: fields.owner,
    reviewed: fields.reviewed,
    reviewBy: fields.reviewBy,
    body,
    headings: extractHeadings(body),
  };
}

/** `##`/`###` headings, minus the ones inside a callout — those are the
 *  callout's own title, not a place in the guide you can navigate to. */
function extractHeadings(body: string): GuideHeading[] {
  const prose = body.replace(/^::: callout-[a-z]+\n[\s\S]*?\n:::$/gm, "");
  return Array.from(prose.matchAll(/^(#{2,3})\s+(.+)$/gm), (match) => ({
    id: slugifyProjectHeading(match[2]),
    title: match[2].replace(/[*_`]/g, ""),
    level: match[1].length as 2 | 3,
  }));
}

function guideFiles(): string[] {
  return readdirSync(CONTENT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name);
}

export const GUIDES: readonly Guide[] = guideFiles()
  .map(parseGuide)
  .sort(
    (a, b) =>
      AUDIENCES.indexOf(a.audience) - AUDIENCES.indexOf(b.audience)
      || a.order - b.order
      || a.lang.localeCompare(b.lang),
  );

export const GUIDE_SUMMARIES: readonly GuideSummary[] = GUIDES.map(
  ({ body: _body, headings: _headings, ...summary }) => summary,
);

export function getGuide(slug: string): Guide | null {
  return GUIDES.find((guide) => guide.slug === slug) ?? null;
}

/** Every guide of one audience in one language, in reading order. */
export function guidesFor(audience: GuideAudience, lang: GuideLang = "en"): GuideSummary[] {
  return GUIDE_SUMMARIES.filter((g) => g.audience === audience && g.lang === lang);
}

/** The same guide in the other language, when it has been translated. */
export function getTranslation(guide: GuideSummary): GuideSummary | null {
  const other: GuideLang = guide.lang === "en" ? "da" : "en";
  return (
    GUIDE_SUMMARIES.find((g) => g.baseSlug === guide.baseSlug && g.lang === other) ?? null
  );
}

/** Previous/next within the same audience track AND language — a Danish guide
 *  never hands the reader on to an English one. */
export function getGuideSiblings(guide: Guide): {
  previous: GuideSummary | null;
  next: GuideSummary | null;
} {
  const track = guidesFor(guide.audience, guide.lang);
  const index = track.findIndex((candidate) => candidate.slug === guide.slug);
  return {
    previous: index > 0 ? track[index - 1] : null,
    next: index >= 0 && index < track.length - 1 ? track[index + 1] : null,
  };
}
