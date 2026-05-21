import Link from "next/link";
import { AppFooter } from "@/components/AppFooter";

export const metadata = {
  title: "Privatlivspolitik — AIPLA",
};

/**
 * /privacy — placeholder.
 *
 * The full Data Protection Impact Assessment (DPIA) signs off in
 * SEQUENCE phase 1.13 (pre-pilot, target 2026-08-08). Until then,
 * this page documents the v0.1 demo's actual data-handling shape
 * so teachers and JB have something concrete to point at.
 *
 * Source-of-truth for the data flow: ADR-001 (anonymous group IDs,
 * no PII collection) in the scoping site at
 * ~/Documents/clients/cph-uni/architecture.qmd.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Privatlivspolitik</h1>
        <p className="text-sm text-muted-foreground">(Privacy notice — v0.1 demo)</p>
      </header>

      <section className="space-y-3 text-sm leading-relaxed">
        <p className="rounded border-l-2 border-yellow-500 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
          <strong>Udkast / Draft.</strong> Den endelige privatlivspolitik
          ledsages af en DPIA-godkendelse før pilotstart 2026-08-14. Indtil
          da beskriver denne side hvad v0.1-demoen <em>faktisk</em> indsamler.
        </p>

        <h2 className="mt-4 text-base font-medium">Hvad vi indsamler — v0.1</h2>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Gruppekode</strong> (fx <code>bright-fox-42</code>) —
            anonym, knyttes ikke til navne. Læreren har koden;
            studerende skriver den ind for at tilslutte sig.
          </li>
          <li>
            <strong>Chat-indhold</strong> — det studerende skriver til
            tutoren, og tutorens svar. Logges til Cloud Trace
            (Google Cloud, EU-region <code>europe-north1</code>) til
            fejlfinding og kvalitetsforbedring.
          </li>
          <li>
            <strong>Interaktioner i arbejdsområdet</strong> — hvilke
            Vis-markører den studerende afslører, hvilke delopgaver
            der markeres som klar, hvilke planeter der vælges i
            simulatoren.
          </li>
        </ul>

        <h2 className="mt-4 text-base font-medium">Hvad vi IKKE indsamler</h2>
        <ul className="ml-5 list-disc space-y-1">
          <li>Navne, e-mails, fødselsdatoer eller andre identifikatorer.</li>
          <li>IP-adresser ud over hvad Google Cloud kortvarigt bruger til rate-limiting.</li>
          <li>Geolokation, kameradata, eller mikrofondata.</li>
        </ul>

        <h2 className="mt-4 text-base font-medium">Tredjepartsbehandlere</h2>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <strong>Google Vertex AI</strong> — sender chat-indhold til
            Gemini-modellen for at generere svar. EU-region pinned hvor muligt.
          </li>
          <li>
            <strong>Anthropic (Claude)</strong> — beredskabsmodel ved
            udfald af primær. Bruges kun ved fallback.
          </li>
        </ul>

        <h2 className="mt-4 text-base font-medium">Spørgsmål</h2>
        <p>
          AIPLA-projektet drives af{" "}
          <strong>Institut for Naturfagenes Didaktik, Københavns Universitet</strong>.
          Spørgsmål om databehandling: kontakt JB via instituttet.
        </p>
      </section>

      <p>
        <Link href="/" className="text-sm underline">
          ← Tilbage til forsiden
        </Link>
      </p>

      <AppFooter />
    </main>
  );
}
