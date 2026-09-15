import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, FileText, Languages } from "lucide-react";

import { GuideBody } from "@/components/guides/GuideBody";
import { PrintButton } from "@/components/guides/PrintButton";
import { PageContainer } from "@/components/site/PageContainer";
import {
  GUIDES,
  getGuide,
  getGuideSiblings,
  getTranslation,
} from "@/lib/guidesContent";

interface GuidePageProps {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: GuidePageProps): Promise<Metadata> {
  const guide = getGuide((await params).slug);
  if (!guide) return {};
  return {
    title: `${guide.title} — AIPLA guides`,
    description: guide.description,
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: { title: guide.title, description: guide.description, type: "article" },
  };
}

/** Copy lives per language: a Danish guide should not be framed in English. */
const COPY = {
  en: {
    all: "All guides",
    onThisPage: "On this page",
    print: "Print this guide",
    pdf: "Download PDF",
    switch: "Læs på dansk",
    previous: "Previous",
    next: "Next",
    reviewed: "Last reviewed",
    audience: { teacher: "Teacher guide", student: "Student guide", researcher: "Researcher guide" },
  },
  da: {
    all: "Alle vejledninger",
    onThisPage: "På denne side",
    print: "Udskriv vejledningen",
    pdf: "Hent PDF",
    switch: "Read in English",
    previous: "Forrige",
    next: "Næste",
    reviewed: "Sidst gennemgået",
    audience: { teacher: "Lærervejledning", student: "Elevvejledning", researcher: "Forskervejledning" },
  },
} as const;

export default async function GuidePage({ params }: GuidePageProps) {
  const guide = getGuide((await params).slug);
  if (!guide) notFound();

  const copy = COPY[guide.lang];
  const { previous, next } = getGuideSiblings(guide);
  const translation = getTranslation(guide);

  return (
    <PageContainer width="wide">
        <div className="grid gap-12 xl:grid-cols-[minmax(0,1fr)_220px]">
          <article className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
              <Link
                href="/guides"
                className="inline-flex items-center gap-2 text-sm font-medium text-brand hover:underline"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {copy.all}
              </Link>
              {translation ? (
                <Link
                  href={`/guides/${translation.slug}`}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
                  hrefLang={translation.lang}
                >
                  <Languages className="h-4 w-4" aria-hidden="true" /> {copy.switch}
                </Link>
              ) : null}
            </div>

            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-brand">
              {guide.tag} · {copy.audience[guide.audience]}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {guide.title}
            </h1>
            <p className="mt-3 max-w-2xl text-lg text-muted-foreground">{guide.description}</p>

            <div className="mt-10">
              <GuideBody markdown={guide.body} />
            </div>

            <p className="mt-12 text-xs text-muted-foreground">
              {copy.reviewed}: <time dateTime={guide.reviewed}>{guide.reviewed}</time> · {guide.owner}
            </p>

            <nav
              aria-label={copy.onThisPage}
              className="mt-8 grid gap-3 border-t border-border pt-8 sm:grid-cols-2 print:hidden"
            >
              {previous ? (
                <Link
                  href={`/guides/${previous.slug}`}
                  className="rounded-lg border border-border p-4 hover:border-brand-line"
                >
                  <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {copy.previous}
                  </span>
                  <span className="mt-2 block font-semibold text-foreground">{previous.title}</span>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link
                  href={`/guides/${next.slug}`}
                  className="rounded-lg border border-border p-4 text-right hover:border-brand-line"
                >
                  <span className="flex items-center justify-end gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {copy.next} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="mt-2 block font-semibold text-foreground">{next.title}</span>
                </Link>
              ) : null}
            </nav>
          </article>

          <aside className="hidden xl:block print:hidden">
            <div className="sticky top-8 rounded-lg border border-border bg-muted/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {copy.onThisPage}
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {guide.headings
                  .filter((heading) => heading.level === 2)
                  .map((heading) => (
                    <li key={heading.id}>
                      <a href={`#${heading.id}`} className="text-muted-foreground hover:text-foreground">
                        {heading.title}
                      </a>
                    </li>
                  ))}
              </ul>
              <div className="mt-4 flex flex-col items-start gap-2 border-t border-border pt-3">
                <a
                  href={`/guides/${guide.slug}.pdf`}
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {copy.pdf}
                </a>
                <PrintButton label={copy.print} />
              </div>
          </div>
        </aside>
      </div>
    </PageContainer>
  );
}
