"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, FlaskConical, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "@/i18n";
import { publicSimScreenshotUrl, type PublicSim } from "@/lib/simLibrary";

/**
 * The homepage's read-only window on the sim library: a screenshot, a name and a
 * line for each sim, and a larger look on click. Nothing here opens or runs a
 * sim — a visitor sees what students work with, not a way in. The list comes
 * from the server (`GET /api/public/sims`); the language from this browser.
 *
 * One row that turns by itself, a card every few seconds, back to the start
 * after the last. It holds still while the pointer or focus is on it, while the
 * larger look is open, while the tab is hidden, for a while after the visitor
 * swipes or clicks an arrow, and always under reduced motion.
 */
export function SimGallery({ sims }: { sims: PublicSim[] }) {
  const t = useT("SimGallery");
  const [open, setOpen] = useState<PublicSim | null>(null);
  const rail = useRef<HTMLUListElement>(null);
  const held = useRef(false); // pointer or focus inside
  const quietUntil = useRef(0); // the visitor moved it: leave it be for a while

  const step = useCallback((dir: 1 | -1) => {
    const el = rail.current;
    const card = el?.querySelector("li");
    if (!el || !card) return;
    const width = card.getBoundingClientRect().width + 16; // + gap-4
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    const atStart = el.scrollLeft <= 4;
    const left = dir === 1 && atEnd ? 0 : dir === -1 && atStart ? el.scrollWidth : el.scrollLeft + dir * width;
    el.scrollTo?.({ left, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (sims.length < 2) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const id = window.setInterval(() => {
      if (held.current || open || document.hidden || Date.now() < quietUntil.current) return;
      step(1);
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [sims.length, open, step]);

  const nudge = (dir: 1 | -1) => {
    quietUntil.current = Date.now() + QUIET_MS;
    step(dir);
  };

  if (sims.length === 0) return null;
  return (
    <section aria-labelledby="sim-gallery-title" className="w-full max-w-5xl text-left">
      <h2 id="sim-gallery-title" className="text-xl font-semibold tracking-tight">
        {t("title")}
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("intro", { count: sims.length })}</p>
      <div
        className="relative mt-5"
        onPointerEnter={() => (held.current = true)}
        onPointerLeave={() => (held.current = false)}
        // Keyboard focus holds it; a mouse click focuses the card too, and must
        // not freeze the row until the visitor clicks somewhere else.
        onFocus={(e) => (held.current = e.target.matches?.(":focus-visible") ?? false)}
        onBlur={() => (held.current = false)}
      >
        <ul
          ref={rail}
          aria-label={t("title")}
          onTouchStart={() => (quietUntil.current = Date.now() + QUIET_MS)}
          onWheel={() => (quietUntil.current = Date.now() + QUIET_MS)}
          className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {sims.map((sim) => (
            <li key={sim.id} className="w-[80%] shrink-0 snap-start sm:w-[calc((100%-1rem)/2)] lg:w-[calc((100%-2rem)/3)]">
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
        {sims.length > 1 ? (
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => nudge(-1)}
              aria-label={t("previous")}
              className="rounded-full border border-border bg-background p-1.5 text-muted-foreground shadow-sm hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => nudge(1)}
              aria-label={t("next")}
              className="rounded-full border border-border bg-background p-1.5 text-muted-foreground shadow-sm hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        ) : null}
      </div>
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

const ROTATE_MS = 4500;
const QUIET_MS = 12000;

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
