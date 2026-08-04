import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, BookOpen, FlaskConical, GraduationCap, Microscope } from "lucide-react";

import { AppFooter } from "@/components/AppFooter";
import { PROJECT_PAGES } from "@/lib/projectContent";

const PAGE_ICONS = {
  about: GraduationCap,
  research: Microscope,
  activities: FlaskConical,
  progress: BookOpen,
} as const;

export const metadata: Metadata = {
  title: "AIPLA project",
  description: "AI in Physics Learning and Assessment at the University of Copenhagen.",
  alternates: { canonical: "/project" },
};

export default function ProjectOverviewPage() {
  return (
    <main>
      <section className="border-b border-border bg-gradient-to-br from-red-950 via-red-900 to-red-800 text-white">
        <div className="px-6 py-16 sm:px-10 sm:py-20 lg:px-14">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-red-100">
            University of Copenhagen · Department of Science Education
          </p>
          <h1 className="mt-5 max-w-4xl text-4xl font-semibold tracking-tight sm:text-6xl">
            AI in Physics Learning and Assessment
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-red-50 sm:text-xl">
            A three-year research project investigating how generative AI can support teaching,
            learning, and assessment in upper-secondary physics.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/project/about" className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2.5 font-medium text-red-900 hover:bg-red-50">
              About the project <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/guides" className="inline-flex items-center gap-2 rounded-md border border-white/40 px-4 py-2.5 font-medium text-white hover:bg-white/10">
              Browse guides
            </Link>
          </div>
        </div>
      </section>

      <section className="px-6 py-12 sm:px-10 lg:px-14">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-red-800">The project</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
            Exploring productive roles for AI in physics education
          </h2>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            AIPLA works with physics teachers to design and study activities where AI supports
            students without replacing the reasoning, experimentation, and communication through
            which physics is learned.
          </p>
        </div>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {PROJECT_PAGES.map((page) => {
            const Icon = PAGE_ICONS[page.slug as keyof typeof PAGE_ICONS];
            return (
              <li key={page.slug}>
                <Link href={`/project/${page.slug}`} className="group flex h-full flex-col rounded-xl border border-border bg-background p-6 transition hover:-translate-y-0.5 hover:border-red-800/40 hover:shadow-md">
                  <Icon className="h-6 w-6 text-red-800" aria-hidden="true" />
                  <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{page.eyebrow}</p>
                  <h3 className="mt-2 text-xl font-semibold text-foreground">{page.title}</h3>
                  <p className="mt-2 flex-1 leading-7 text-muted-foreground">{page.description}</p>
                  <span className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-red-800">
                    Read more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        <section className="mt-14 grid gap-6 rounded-xl bg-muted p-6 sm:grid-cols-3 sm:p-8" aria-label="Project facts">
          <div><p className="text-2xl font-semibold text-foreground">2026–2028</p><p className="mt-1 text-sm text-muted-foreground">Project period</p></div>
          <div><p className="text-2xl font-semibold text-foreground">Physics</p><p className="mt-1 text-sm text-muted-foreground">Upper-secondary education</p></div>
          <div><p className="text-2xl font-semibold text-foreground">Denmark</p><p className="mt-1 text-sm text-muted-foreground">Developed with teachers</p></div>
        </section>

        <div className="flex justify-center"><AppFooter /></div>
      </section>
    </main>
  );
}
