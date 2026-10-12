import { PageContainer } from "@/components/site/PageContainer";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata = {
  title: "Vilkår — AIPLA",
};

/**
 * /terms — interim terms of use.
 *
 * Full terms are being prepared with the University of Copenhagen; until
 * then this page states only what is true today and points to the privacy
 * notice and the teacher FAQ. Corrected 2026-10-08: it still called AIPLA a
 * four-month "v0.1 demo" and promised full terms at the 2026-08-14 pilot start.
 */
export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <PageContainer>
        <main className="flex flex-col gap-6">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold">Vilkår</h1>
            <p className="text-sm text-muted-foreground">(Terms of use — interim)</p>
          </header>

          <section className="space-y-3 text-sm leading-relaxed">
            <p className="rounded border-l-2 border-yellow-500 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
              <strong>Foreløbige vilkår / Interim terms.</strong> AIPLA er en
              forskningsplatform i pilotfase, ikke en offentlig tjeneste. De
              fulde vilkår udarbejdes sammen med Københavns Universitet.
            </p>

            <h2 className="mt-4 text-base font-medium">Hvad er AIPLA?</h2>
            <p>
              AIPLA (<em>AI in Physics Learning and Assessment</em>) er et
              forskningsprojekt (2026–2028) drevet af Institut for
              Naturfagenes Didaktik, Københavns Universitet. Formålet er at
              undersøge hvordan AI-tutorer kan understøtte fysik-undervisning
              på gymnasialt niveau, ikke erstatte den.
            </p>

            <h2 className="mt-4 text-base font-medium">Brug</h2>
            <ul className="ml-5 list-disc space-y-1">
              <li>Elever bruger AIPLA med en gruppekode fra deres lærer; lærere logger ind med deres egen konto.</li>
              <li>Tutoren er forskningsteknologi — den kan tage fejl. Kontroller altid beregninger selv.</li>
              <li>Indsend ikke personlige oplysninger (navne, adresser, billeder af jer selv).</li>
            </ul>

            <h2 className="mt-4 text-base font-medium">Ansvarsfraskrivelse</h2>
            <p>
              AIPLA giver ingen garantier for korrekthed eller pædagogisk
              effekt i forskningsfasen. Resultater bruges til at forme den
              endelige version sammen med UCPH og deltagende lærere.
            </p>

            <h2 className="mt-4 text-base font-medium">Data og spørgsmål</h2>
            <p>
              Hvordan data behandles, står i{" "}
              <a href="/privacy" className="underline">privatlivserklæringen</a>.
              Svar på lærernes spørgsmål om dokumenter, gruppekoder, rettigheder
              og data findes under{" "}
              <a href="/project/teacher-faq.da" className="underline">Spørgsmål fra lærere</a>.
            </p>
          </section>

        </main>
      </PageContainer>
    </>
  );
}
