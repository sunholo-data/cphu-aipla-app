import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { notFound } from "next/navigation";

import { AppFooter } from "@/components/AppFooter";
import { ProjectMarkdown } from "@/components/project/ProjectMarkdown";
import { getProjectPage, getProjectSiblings, PROJECT_ALL_PAGES } from "@/lib/projectContent";

interface ProjectPageProps {
  params: Promise<{ slug: string[] }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return PROJECT_ALL_PAGES.map((page) => ({ slug: page.slug.split("/") }));
}

export async function generateMetadata({ params }: ProjectPageProps): Promise<Metadata> {
  const slug = (await params).slug.join("/");
  const page = getProjectPage(slug);
  if (!page) return {};
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: `/project/${page.slug}` },
    openGraph: {
      title: page.title,
      description: page.description,
      type: "article",
    },
  };
}

export default async function ProjectPageRoute({ params }: ProjectPageProps) {
  const slug = (await params).slug.join("/");
  const page = getProjectPage(slug);
  if (!page) notFound();

  const { previous, next } = getProjectSiblings(page);
  const parent = page.slug.includes("/") ? getProjectPage(page.slug.split("/")[0]) : null;

  return (
    <main className="px-6 py-10 sm:px-10 lg:px-14 lg:py-14">
      <div className="mx-auto grid max-w-5xl gap-12 xl:grid-cols-[minmax(0,1fr)_220px]">
        <article className="min-w-0">
          {parent ? (
            <Link href={`/project/${parent.slug}`} className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-red-800 hover:underline">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {parent.title}
            </Link>
          ) : null}
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-red-800">{page.eyebrow}</p>
          <ProjectMarkdown>{page.body}</ProjectMarkdown>

          <dl className="mt-12 grid gap-4 rounded-lg border border-border bg-muted/40 p-5 text-sm sm:grid-cols-3">
            <div>
              <dt className="font-medium text-foreground">Content status</dt>
              <dd className="mt-1 text-muted-foreground">{page.status}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Maintained by</dt>
              <dd className="mt-1 text-muted-foreground">{page.owner}</dd>
            </div>
            <div>
              <dt className="font-medium text-foreground">Last reviewed</dt>
              <dd className="mt-1 text-muted-foreground"><time dateTime={page.reviewed}>{page.reviewed}</time></dd>
            </div>
          </dl>

          <nav aria-label="Previous and next project pages" className="mt-10 grid gap-3 border-t border-border pt-8 sm:grid-cols-2">
            {previous ? (
              <Link href={`/project/${previous.slug}`} className="group rounded-lg border border-border p-4 hover:border-red-800/40">
                <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Previous</span>
                <span className="mt-2 block font-semibold text-foreground">{previous.title}</span>
              </Link>
            ) : <span />}
            {next ? (
              <Link href={`/project/${next.slug}`} className="group rounded-lg border border-border p-4 text-right hover:border-red-800/40">
                <span className="flex items-center justify-end gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Next <ArrowRight className="h-3.5 w-3.5" /></span>
                <span className="mt-2 block font-semibold text-foreground">{next.title}</span>
              </Link>
            ) : null}
          </nav>
          <AppFooter />
        </article>

        <aside className="hidden xl:block">
          <div className="sticky top-8 rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">On this page</p>
            <ul className="mt-3 space-y-2 text-sm">
              {page.headings.filter((heading) => heading.level === 2).map((heading) => (
                <li key={heading.id}>
                  <a href={`#${heading.id}`} className="text-muted-foreground hover:text-foreground">{heading.title}</a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
