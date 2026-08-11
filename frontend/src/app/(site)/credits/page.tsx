import { PageContainer } from "@/components/site/PageContainer";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata = {
  title: "Krediteringer — AIPLA",
};

/**
 * /credits — third-party attribution. Lives separately from /privacy
 * and /terms because the licensing requirements are different shape
 * (per-asset CC attribution vs. legal policy text).
 *
 * Source on disk: CREDITS.md at the repo root. This page surfaces
 * the user-facing subset.
 */
export default function CreditsPage() {
  return (
    <>
      <SiteHeader />
      <PageContainer>
        <main className="flex flex-col gap-6">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold">Krediteringer</h1>
            <p className="text-sm text-muted-foreground">(Credits & licenses)</p>
          </header>

          <section className="space-y-3 text-sm leading-relaxed">
            <h2 className="mt-2 text-base font-medium">Logo</h2>
            <p>
              KU coat-of-arms (Københavns Universitet) by{" "}
              <a
                className="underline"
                href="https://commons.wikimedia.org/wiki/File:Ku-ucph-logo-svg.svg"
                rel="noopener noreferrer"
                target="_blank"
              >
                Canconier on Wikimedia Commons
              </a>
              , licensed{" "}
              <a
                className="underline"
                href="https://creativecommons.org/licenses/by-sa/4.0/"
                rel="noopener noreferrer"
                target="_blank"
              >
                CC BY-SA 4.0
              </a>
              .
            </p>

            <h2 className="mt-4 text-base font-medium">Software</h2>
            <ul className="ml-5 list-disc space-y-1">
              <li>
                AI-svar genereret af Google Gemini via Vertex AI med fallback til
                Anthropic Claude.
              </li>
              <li>
                Bygget på{" "}
                <a
                  className="underline"
                  href="https://adk.dev/"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Google ADK
                </a>{" "}
                + AG-UI + A2UI + MCP-protokollerne.
              </li>
              <li>
                Open-source komponenter: Next.js, React, Tailwind, FastAPI,
                pgvector, KaTeX (matematik-rendering), DOMPurify (SVG-sanitering).
              </li>
            </ul>

            <h2 className="mt-4 text-base font-medium">Projekt</h2>
            <p>
              AIPLA-projektet drives af{" "}
              <strong>Institut for Naturfagenes Didaktik, Københavns Universitet</strong>,
              som del af Center for Digital Education's forskning i AI-understøttet
              læring i naturvidenskab.
            </p>
          </section>

        </main>
      </PageContainer>
    </>
  );
}
