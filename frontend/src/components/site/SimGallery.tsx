"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { FlaskConical, X } from "lucide-react";
import { useState } from "react";

import { useT } from "@/i18n";
import { publicSimScreenshotUrl, type PublicSim } from "@/lib/simLibrary";

/**
 * The homepage's read-only window on the sim library: a screenshot, a name and a
 * line for each sim, and a larger look on click. Nothing here opens or runs a
 * sim — a visitor sees what students work with, not a way in. The list comes
 * from the server (`GET /api/public/sims`); the language from this browser.
 */
export function SimGallery({ sims }: { sims: PublicSim[] }) {
  const t = useT("SimGallery");
  const [open, setOpen] = useState<PublicSim | null>(null);
  if (sims.length === 0) return null;
  return (
    <section aria-labelledby="sim-gallery-title" className="w-full max-w-5xl text-left">
      <h2 id="sim-gallery-title" className="text-xl font-semibold tracking-tight">
        {t("title")}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("intro", { count: sims.length })}</p>
      <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sims.map((sim) => (
          <li key={sim.id}>
            <button
              type="button"
              onClick={() => setOpen(sim)}
              data-testid={`sim-gallery-${sim.id}`}
              className="group flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-background text-left shadow-sm transition hover:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Shot sim={sim} className="aspect-[4/3] w-full border-b border-border" />
              <span className="flex flex-1 flex-col gap-1.5 p-3">
                <span className="text-sm font-semibold leading-snug">{sim.displayName}</span>
                {sim.description ? (
                  <span className="line-clamp-2 text-xs text-muted-foreground">{sim.description}</span>
                ) : null}
                <Chips sim={sim} limit={3} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted-foreground">{t("elsewhere")}</p>

      <Dialog.Root open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-900/60" />
          {open ? (
            <Dialog.Content
              aria-describedby={undefined}
              className="fixed inset-x-4 top-1/2 z-50 mx-auto flex max-h-[90dvh] max-w-3xl -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
            >
              <div className="flex items-start justify-between gap-3 border-b border-border p-4">
                <Dialog.Title className="text-base font-semibold">{open.displayName}</Dialog.Title>
                <Dialog.Close
                  aria-label={t("close")}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </Dialog.Close>
              </div>
              <div className="overflow-y-auto">
                <Shot sim={open} shot="driven" className="w-full border-b border-border" />
                <div className="flex flex-col gap-2 p-4">
                  {open.description ? <p className="text-sm">{open.description}</p> : null}
                  <Chips sim={open} />
                  {open.source === "teacher" ? (
                    <p className="text-xs text-muted-foreground">{t("byTeacher")}</p>
                  ) : null}
                </div>
              </div>
            </Dialog.Content>
          ) : null}
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

/** A sim's screenshot, cropped from the top (its title and stage); a quiet tile if there is none. */
function Shot({ sim, shot = "700", className }: { sim: PublicSim; shot?: "700" | "driven"; className: string }) {
  const t = useT("SimGallery");
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`flex items-center justify-center bg-muted ${className} ${shot === "driven" ? "aspect-[4/3]" : ""}`}>
        <FlaskConical className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
      </span>
    );
  }
  return (
    // A static PNG from the backend; next/image adds nothing here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={publicSimScreenshotUrl(sim.id, shot)}
      alt={t("shotAlt", { name: sim.displayName })}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`bg-white object-cover object-top ${className}`}
    />
  );
}

function Chips({ sim, limit }: { sim: PublicSim; limit?: number }) {
  const t = useT("SimGallery");
  const topics = limit ? sim.topics.slice(0, limit) : sim.topics;
  return (
    <span className="mt-auto flex flex-wrap gap-1 pt-1">
      {sim.levels.length > 0 ? (
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
          {t("levels", { levels: sim.levels.join("/") })}
        </span>
      ) : null}
      {topics.map((topic) => (
        <span key={topic} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {topic}
        </span>
      ))}
    </span>
  );
}
