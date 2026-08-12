import { PageContainer } from "@/components/site/PageContainer";
import { SiteHeader } from "@/components/site/SiteHeader";

import { AccessRequestForm } from "./_AccessRequestForm";

export const metadata = {
  title: "Bliv en del af programmet — AIPLA",
  description:
    "AIPLA is a research programme at the University of Copenhagen. Teachers in the programme get a live physics tutor for their classes.",
};

/**
 * /teacher-access — what a visitor sees when they want the live product
 * (ACCESS-1 M4).
 *
 * In the `(site)` route group on purpose: the footer is structural there, and
 * `route-chrome-coverage.test.ts` fails by filename for any public page added
 * outside it. It is also readable signed OUT — someone deciding whether to
 * create an account should be able to read what they would be joining.
 */
export default function TeacherAccessPage() {
  return (
    <>
      <SiteHeader />
      <PageContainer>
        <main className="flex flex-col gap-8">
          <header className="space-y-1">
            <h1 className="text-2xl font-semibold">Bliv en del af programmet</h1>
            <p className="text-sm text-muted-foreground">(Join the programme)</p>
          </header>

          <section className="space-y-3 text-sm leading-relaxed">
            <p>
              AIPLA er et forskningsprogram på Københavns Universitet om AI i
              fysikundervisning og -evaluering. Alle kan logge ind og udforske
              appen — bygge aktiviteter, se på simulationerne, og følge en{" "}
              <strong>optaget</strong> samtale med tutoren.
            </p>
            <p className="text-muted-foreground">
              AIPLA is a research programme at the University of Copenhagen on AI
              in physics learning and assessment. Anyone can sign in and explore
              the app — build activities, open the simulations, and watch a{" "}
              <strong>recorded</strong> tutoring session play out.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-medium">
              Hvad deltagere får / What participants get
            </h2>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
              <li>
                En <strong>live</strong> fysik-tutor til dine klasser, ikke en
                optagelse.{" "}
                <span className="text-muted-foreground">
                  A live physics tutor for your classes, not a recording.
                </span>
              </li>
              <li>
                Elevkoder, så dine elever kan deltage anonymt — uden konti og
                uden persondata.{" "}
                <span className="text-muted-foreground">
                  Student join codes, so your class takes part anonymously — no
                  accounts, no personal data.
                </span>
              </li>
              <li>
                Dine egne materialer i tutorens vidensgrundlag.{" "}
                <span className="text-muted-foreground">
                  Your own curriculum material in the tutor&rsquo;s knowledge base.
                </span>
              </li>
              <li>
                Rapporter over hvad klassen faktisk kæmpede med.{" "}
                <span className="text-muted-foreground">
                  Reports on what the class actually struggled with.
                </span>
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-medium">
              Hvorfor der er en venteliste / Why access is invited
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Every live tutor turn is a paid model call on a research budget, and
              the programme is a funded study with a defined cohort rather than a
              commercial product. Inviting participants individually is how the
              spend stays attributable to the research — and it is why the demo
              you can already explore is a recording rather than a trial.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-medium">Forespørg om adgang / Request access</h2>
            <AccessRequestForm />
          </section>
        </main>
      </PageContainer>
    </>
  );
}
