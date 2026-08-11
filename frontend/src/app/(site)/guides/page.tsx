import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BookOpen, FileText, GraduationCap, Microscope, Users } from "lucide-react";

export const metadata: Metadata = {
  title: "Guides — AIPLA",
  description: "How-to guides for teachers and students using AIPLA.",
};

interface Guide {
  slug: string;
  tag: string;
  title: string;
  desc: string;
  /** A Danish (`<slug>.da.*`) version exists — show it as the primary link. */
  da?: boolean;
}

const TEACHER_GUIDES: Guide[] = [
  {
    slug: "t1-set-up-a-class",
    tag: "T1",
    title: "Set up a class and share it",
    desc: "Create a class, mint group codes, and share them with students.",
    da: true,
  },
  {
    slug: "t2-create-your-first-activity",
    tag: "T2",
    title: "Create your first activity",
    desc: "Build a guided activity: teaching goal, workspace, and live preview.",
    da: true,
  },
  {
    slug: "t3-add-curriculum-materials",
    tag: "T3",
    title: "Add and organise curriculum materials",
    desc: "Attach documents the tutor can cite, and keep them organised.",
    da: true,
  },
  {
    slug: "t4-author-with-the-copilot",
    tag: "T4",
    title: "Author with the AI co-pilot",
    desc: "Describe what you want to teach and let the co-pilot draft it.",
    da: true,
  },
];

const STUDENT_GUIDES: Guide[] = [
  {
    slug: "s1-join-and-use-your-tutor",
    tag: "S1",
    title: "Join and use your tutor",
    desc: "Join with a group code and work with the tutor and its workspace.",
    da: true,
  },
];

const RESEARCHER_GUIDES: Guide[] = [
  {
    slug: "r1-researcher-onboarding",
    tag: "R1",
    title: "Researcher onboarding",
    desc: "Cross-teacher observation and the rubric experimentation workspace.",
  },
];

function GuideCard({ g }: { g: Guide }) {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-foreground">
          {g.tag}
        </span>
        <div className="min-w-0">
          <h3 className="font-medium text-foreground">{g.title}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{g.desc}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={`/guides/${g.slug}${g.da ? ".da" : ""}.html`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" /> {g.da ? "Åbn" : "Open"}
        </a>
        <a
          href={`/guides/${g.slug}${g.da ? ".da" : ""}.pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <FileText className="h-4 w-4" aria-hidden="true" /> PDF
        </a>
      </div>
      {g.da ? (
        <p className="text-xs text-muted-foreground">
          English:{" "}
          <a
            href={`/guides/${g.slug}.html`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Open
          </a>{" "}
          ·{" "}
          <a
            href={`/guides/${g.slug}.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            PDF
          </a>
        </p>
      ) : null}
    </li>
  );
}

export default function GuidesPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Home
      </Link>

      <h1 className="text-2xl font-semibold sm:text-3xl">AIPLA guides</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Short, task-focused how-to guides. Open one in your browser, or download
        the PDF. Teacher and student guides are available in Danish and English.
      </p>

      <section className="mt-8" aria-labelledby="teacher-guides">
        <h2
          id="teacher-guides"
          className="mb-3 flex items-center gap-2 text-lg font-semibold"
        >
          <Users className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          For teachers
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {TEACHER_GUIDES.map((g) => (
            <GuideCard key={g.slug} g={g} />
          ))}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="student-guides">
        <h2
          id="student-guides"
          className="mb-3 flex items-center gap-2 text-lg font-semibold"
        >
          <GraduationCap className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          For students
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {STUDENT_GUIDES.map((g) => (
            <GuideCard key={g.slug} g={g} />
          ))}
        </ul>
      </section>

      <section className="mt-8" aria-labelledby="researcher-guides">
        <h2
          id="researcher-guides"
          className="mb-3 flex items-center gap-2 text-lg font-semibold"
        >
          <Microscope className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          For researchers
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {RESEARCHER_GUIDES.map((g) => (
            <GuideCard key={g.slug} g={g} />
          ))}
        </ul>
      </section>
    </main>
  );
}
