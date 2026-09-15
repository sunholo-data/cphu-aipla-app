import type { Metadata } from "next";
import Link from "next/link";
import { FileText, GraduationCap, Microscope, Users } from "lucide-react";

import { PageContainer } from "@/components/site/PageContainer";
import {
  type GuideAudience,
  type GuideSummary,
  getTranslation,
  guidesFor,
} from "@/lib/guidesContent";

export const metadata: Metadata = {
  title: "Guides — AIPLA",
  description: "How-to guides for teachers and students using AIPLA.",
};

/**
 * The guide index (1.1.116).
 *
 * The list used to be a hand-maintained array of slugs pointing at static
 * Quarto HTML + PDF files, so adding a guide meant editing this file and
 * remembering the `da` flag. It now reads the content tree: a new
 * `content/guides/<slug>.md` appears here on its own, in its audience track.
 */
const SECTIONS: { audience: GuideAudience; title: string; Icon: typeof Users }[] = [
  { audience: "teacher", title: "For teachers", Icon: Users },
  { audience: "student", title: "For students", Icon: GraduationCap },
  { audience: "researcher", title: "For researchers", Icon: Microscope },
];

function GuideCard({ guide }: { guide: GuideSummary }) {
  const danish = getTranslation(guide);
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <Link href={`/guides/${guide.slug}`} className="flex items-start gap-3 group">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-foreground">
          {guide.tag}
        </span>
        <span className="min-w-0">
          <span className="block font-medium text-foreground group-hover:text-brand">
            {guide.title}
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{guide.description}</span>
        </span>
      </Link>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {danish ? (
          <Link
            href={`/guides/${danish.slug}`}
            hrefLang="da"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Læs på dansk
          </Link>
        ) : null}
        <a
          href={`/guides/${guide.slug}.pdf`}
          className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden="true" /> PDF
        </a>
      </div>
    </li>
  );
}

export default function GuidesPage() {
  return (
    <PageContainer width="wide">
        <main>
          <h1 className="text-2xl font-semibold sm:text-3xl">AIPLA guides</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Short, task-focused how-to guides. Read one here, or download the
            PDF. Teacher and student guides are available in Danish and English.
          </p>

          {SECTIONS.map(({ audience, title, Icon }) => {
            const guides = guidesFor(audience);
            if (guides.length === 0) return null;
            return (
              <section key={audience} className="mt-8" aria-labelledby={`${audience}-guides`}>
                <h2
                  id={`${audience}-guides`}
                  className="mb-3 flex items-center gap-2 text-lg font-semibold"
                >
                  <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  {title}
                </h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {guides.map((guide) => (
                    <GuideCard key={guide.slug} guide={guide} />
                  ))}
                </ul>
              </section>
            );
          })}
        </main>
    </PageContainer>
  );
}
