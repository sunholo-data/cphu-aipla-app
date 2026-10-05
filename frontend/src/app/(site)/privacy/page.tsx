import type { ReactNode } from "react";

import { PageContainer } from "@/components/site/PageContainer";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata = {
  title: "Privatlivspolitik — AIPLA",
};

/**
 * /privacy — what AIPLA collects, where it is stored, who processes it.
 *
 * Rewritten 2026-10-05 for KU legal's review: the previous page was the v0.1
 * draft and had become wrong (Cloud Trace as the chat store, an Anthropic
 * fallback that does not exist, "no camera or microphone data"). Every
 * location here was read off the live prod project on 2026-10-05.
 *
 * The teacher privacy notice (`PrivacyNoticeGate`) links here. If the
 * SUBSTANCE of this page changes, bump `PRIVACY_NOTICE_VERSION` in
 * `backend/db/privacy_ack.py` so every teacher is shown the notice again.
 *
 * Danish first, English below — one page, so the two cannot drift apart
 * across files.
 */

type Copy = {
  heading: string;
  status: string;
  intro: string;
  sections: { title: string; body: ReactNode }[];
};

const LOCATIONS_DA: [string, string][] = [
  ["Applikation og database (Cloud Run, Firestore)", "Finland (europe-north1)"],
  ["Filer, uploads, lydoptagelser, logfiler", "Finland (europe-north1)"],
  ["Forskningslog over chat (BigQuery)", "Finland (europe-north1)"],
  ["AI-modeller (Gemini via Google Cloud)", "EU (Googles EU-region)"],
  ["Samtalehistorik og søgning i undervisningsmateriale", "Belgien (europe-west1)"],
  ["Oplæsning (tekst-til-tale)", "EU-endpoint"],
  ["Dokumentkonvertering (AILANG Parse, drevet af Sunholo)", "Belgien (europe-west1)"],
  ["Login for lærere (Firebase Authentication)", "Googles globale login-tjeneste"],
];

const LOCATIONS_EN: [string, string][] = [
  ["Application and database (Cloud Run, Firestore)", "Finland (europe-north1)"],
  ["Files, uploads, audio recordings, logs", "Finland (europe-north1)"],
  ["Research log of chats (BigQuery)", "Finland (europe-north1)"],
  ["AI models (Gemini via Google Cloud)", "EU (Google's EU multi-region)"],
  ["Conversation history and curriculum search", "Belgium (europe-west1)"],
  ["Read-aloud (text-to-speech)", "EU endpoint"],
  ["Document conversion (AILANG Parse, operated by Sunholo)", "Belgium (europe-west1)"],
  ["Teacher sign-in (Firebase Authentication)", "Google's global sign-in service"],
];

function LocationTable({ rows, headers }: { rows: [string, string][]; headers: [string, string] }) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className="py-1 pr-4 font-medium">{headers[0]}</th>
          <th className="py-1 font-medium">{headers[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([what, where]) => (
          <tr key={what} className="border-b border-border/60">
            <td className="py-1 pr-4">{what}</td>
            <td className="py-1">{where}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const DA: Copy = {
  heading: "Privatlivspolitik",
  status:
    "Opdateret 5. oktober 2026. Udkast, der afventer gennemgang hos Københavns Universitets juridiske afdeling og databeskyttelsesrådgiver.",
  intro:
    "AIPLA (AI in Physics Learning and Assessment) er et forskningsprojekt ved Institut for Naturfagenes Didaktik, Københavns Universitet. Denne side beskriver, hvilke data platformen indsamler, hvor de gemmes, og hvem der behandler dem.",
  sections: [
    {
      title: "Dataansvarlig og kontakt",
      body: (
        <p>
          Københavns Universitet er dataansvarlig. Projektleder er Jesper Bruun (
          <a className="underline" href="mailto:jbruun@ind.ku.dk">jbruun@ind.ku.dk</a>), som du kan kontakte med
          spørgsmål, eller hvis du vil have indsigt i, rettet eller slettet dine data. Du kan også kontakte
          Københavns Universitets databeskyttelsesrådgiver.
        </p>
      ),
    },
    {
      title: "Elever",
      body: (
        <ul className="ml-5 list-disc space-y-1">
          <li>
            Elever er anonyme. De logger ind med en gruppekode fra læreren, i grupper på mindst tre. Vi indsamler ikke
            navne, e-mails eller andre identifikatorer.
          </li>
          <li>
            Vi gemmer det, gruppen skriver til tutoren, tutorens svar, og hvad gruppen gør i arbejdsområdet (fx
            simuleringer, tabeller og tjeklister). Det bruges i forskningsprojektet.
          </li>
          <li>
            Elever kan uploade billeder og dokumenter til tutoren. <strong>Elever må ikke skrive navne eller
            CPR-numre og må ikke uploade dokumenter eller billeder med navne, CPR-numre eller af sig selv.</strong> Det
            står også i elevernes chat.
          </li>
          <li>
            Tale til tutoren omdannes til tekst og gemmes ikke som lyd. Lydoptagelse af en hel lektion sker kun, hvis
            læreren slår det til for klassen, og kun med underskrevne samtykkeerklæringer.
          </li>
        </ul>
      ),
    },
    {
      title: "Lærere",
      body: (
        <ul className="ml-5 list-disc space-y-1">
          <li>
            Lærere logger ind med deres arbejdsmail via Google. Vi gemmer e-mail, navn og profilbillede fra Google,
            samt de klasser, aktiviteter og materialer, læreren opretter.
          </li>
          <li>Beskeder, som læreren sender til platformens AI-assistenter, kan blive gemt.</li>
          <li>Lærere skal bekræfte, at de har læst denne information, før de bruger platformen.</li>
        </ul>
      ),
    },
    {
      title: "Hvor data gemmes og behandles",
      body: (
        <>
          <p className="mb-2">
            Platformen kører på Google Cloud under Københavns Universitets aftale med Google. Alle data gemmes og
            behandles i EU, undtagen selve login-tjenesten for lærere, som Google driver globalt.
          </p>
          <LocationTable rows={LOCATIONS_DA} headers={["Hvad", "Hvor"]} />
        </>
      ),
    },
    {
      title: "Databehandlere",
      body: (
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Google Cloud</strong>: hosting, database og AI-modellerne (Gemini). Google må ikke bruge data til
            at træne eller finjustere sine AI-modeller (Google Cloud Service Specific Terms, afsnit 18).
          </li>
          <li>
            <strong>Sunholo</strong>: udvikler og drifter platformen og konverterer uploadede dokumenter til tekst.
          </li>
        </ul>
      ),
    },
    {
      title: "Opbevaring",
      body: (
        <ul className="ml-5 list-disc space-y-1">
          <li>Tekniske logfiler slettes efter 30 dage.</li>
          <li>Forskningsloggen over chat slettes efter 365 dage.</li>
          <li>Klasser, aktiviteter og elevarbejde gemmes, indtil læreren sletter dem, eller projektet afsluttes.</li>
        </ul>
      ),
    },
  ],
};

const EN: Copy = {
  heading: "Privacy notice",
  status:
    "Updated 5 October 2026. Draft, pending review by the University of Copenhagen's legal office and data protection officer.",
  intro:
    "AIPLA (AI in Physics Learning and Assessment) is a research project at the Department of Science Education, University of Copenhagen. This page describes what data the platform collects, where it is stored, and who processes it.",
  sections: [
    {
      title: "Controller and contact",
      body: (
        <p>
          The University of Copenhagen is the data controller. The project lead is Jesper Bruun (
          <a className="underline" href="mailto:jbruun@ind.ku.dk">jbruun@ind.ku.dk</a>). Contact him with questions,
          or to see, correct or delete your data. You can also contact the University of Copenhagen's data
          protection officer.
        </p>
      ),
    },
    {
      title: "Students",
      body: (
        <ul className="ml-5 list-disc space-y-1">
          <li>
            Students are anonymous. They sign in with a group code from their teacher, in groups of at least three. We
            do not collect names, emails or other identifiers.
          </li>
          <li>
            We store what the group writes to the tutor, the tutor's replies, and what the group does in the workspace
            (for example simulations, tables and checklists). This is used in the research project.
          </li>
          <li>
            Students can upload pictures and documents to the tutor. <strong>Students must not write names or CPR
            numbers, and must not upload documents or pictures that show names, CPR numbers or themselves.</strong>{" "}
            Their chat says so too.
          </li>
          <li>
            Speech to the tutor is converted to text and not kept as audio. A whole lesson is recorded only if the
            teacher turns that on for the class, and only with signed consent forms.
          </li>
        </ul>
      ),
    },
    {
      title: "Teachers",
      body: (
        <ul className="ml-5 list-disc space-y-1">
          <li>
            Teachers sign in with their work email through Google. We store the email, name and profile picture from
            Google, and the classes, activities and materials the teacher creates.
          </li>
          <li>Messages a teacher sends to the platform's AI assistants may be stored.</li>
          <li>Teachers must confirm they have read this information before using the platform.</li>
        </ul>
      ),
    },
    {
      title: "Where data is stored and processed",
      body: (
        <>
          <p className="mb-2">
            The platform runs on Google Cloud under the University of Copenhagen's agreement with Google. All data is
            stored and processed in the EU, except the teacher sign-in service itself, which Google runs globally.
          </p>
          <LocationTable rows={LOCATIONS_EN} headers={["What", "Where"]} />
        </>
      ),
    },
    {
      title: "Processors",
      body: (
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Google Cloud</strong>: hosting, database and the AI models (Gemini). Google may not use the data
            to train or fine-tune its AI models (Google Cloud Service Specific Terms, section 18).
          </li>
          <li>
            <strong>Sunholo</strong>: develops and operates the platform, and converts uploaded documents to text.
          </li>
        </ul>
      ),
    },
    {
      title: "Retention",
      body: (
        <ul className="ml-5 list-disc space-y-1">
          <li>Technical logs are deleted after 30 days.</li>
          <li>The research log of chats is deleted after 365 days.</li>
          <li>Classes, activities and student work are kept until the teacher deletes them or the project ends.</li>
        </ul>
      ),
    },
  ],
};

function Section({ copy, lang }: { copy: Copy; lang: "da" | "en" }) {
  return (
    <section lang={lang} className="space-y-4 text-sm leading-relaxed">
      <header className="space-y-1">
        <h2 className="text-2xl font-semibold">{copy.heading}</h2>
        <p className="rounded border-l-2 border-yellow-500 bg-yellow-50 px-3 py-2 text-xs text-yellow-900 dark:bg-yellow-950 dark:text-yellow-100">
          {copy.status}
        </p>
      </header>
      <p>{copy.intro}</p>
      {copy.sections.map((s) => (
        <div key={s.title} className="space-y-2">
          <h3 className="text-base font-medium">{s.title}</h3>
          {s.body}
        </div>
      ))}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <PageContainer>
        <main className="flex flex-col gap-10">
          <h1 className="sr-only">Privatlivspolitik / Privacy notice</h1>
          <p className="text-sm">
            <a href="#en" className="underline">
              English version below
            </a>
          </p>
          <Section copy={DA} lang="da" />
          <div id="en">
            <Section copy={EN} lang="en" />
          </div>
        </main>
      </PageContainer>
    </>
  );
}
