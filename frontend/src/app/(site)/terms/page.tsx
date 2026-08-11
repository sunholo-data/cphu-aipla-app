import { PageContainer } from "@/components/site/PageContainer";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata = {
  title: "Vilkår — AIPLA",
};

/**
 * /terms — placeholder.
 *
 * v0.1 is a research demo, not a service offering. The "terms" page
 * is here so the footer link goes somewhere — full ToS land in v1
 * alongside the DPIA + Strand A compliance review.
 */
export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <PageContainer>
        <main className="flex flex-col gap-6">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold">Vilkår</h1>
            <p className="text-sm text-muted-foreground">(Terms of use — v0.1 demo)</p>
          </header>

          <section className="space-y-3 text-sm leading-relaxed">
            <p className="rounded border-l-2 border-yellow-500 bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
              <strong>Udkast / Draft.</strong> AIPLA v0.1 er en forskningsdemo,
              ikke en offentlig tjeneste. Fulde vilkår følger med pilotstarten
              2026-08-14.
            </p>

            <h2 className="mt-4 text-base font-medium">Hvad er AIPLA?</h2>
            <p>
              AIPLA (<em>AI in Physics Learning and Assessment</em>) er et
              fire-måneders forskningsprojekt drevet af Institut for
              Naturfagenes Didaktik, Københavns Universitet. Formålet er at
              undersøge hvordan AI-tutorer kan understøtte fysik-undervisning
              på gymnasialt niveau, ikke erstatte den.
            </p>

            <h2 className="mt-4 text-base font-medium">Brug</h2>
            <ul className="ml-5 list-disc space-y-1">
              <li>Kun til adgang via en lærergivet gruppekode.</li>
              <li>Tutoren er forskningsteknologi — den kan tage fejl. Kontroller altid beregninger selv.</li>
              <li>Indsend ikke personlige oplysninger (navne, adresser, billeder af jer selv).</li>
            </ul>

            <h2 className="mt-4 text-base font-medium">Ansvarsfraskrivelse</h2>
            <p>
              AIPLA giver ingen garantier for korrekthed eller pædagogisk
              effekt i forskningsfasen. Resultater bruges til at forme den
              endelige version sammen med UCPH og deltagende lærere.
            </p>
          </section>

        </main>
      </PageContainer>
    </>
  );
}
