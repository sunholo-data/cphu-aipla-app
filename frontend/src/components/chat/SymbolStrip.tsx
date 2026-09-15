"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 1.1.118 — physics symbols a student can type. A 16-year-old on a Danish
 * laptop keyboard has no `Δ`, `ρ`, `²` or `°`; the tutor writes them (rendered
 * from LaTeX) and the student cannot write them back. One tap inserts the
 * UNICODE character at the caret — not LaTeX, so what the student sends is an
 * ordinary string that renders as itself in their bubble, in the chat log and
 * in the writing export, and the model reads `Δv` as plainly as `delta v`.
 *
 * Three pieces, one file, so the parent owns the open state and can place the
 * toggle in its button row and the chip row wherever its layout wants:
 *   - `useSymbolStrip({ wink })` — open state + the first-visit wink
 *   - `<SymbolStripToggle>`     — the Ω button
 *   - `<SymbolStrip>`           — the chip row
 * Insertion is the caller's (`insertAtCaret` + `restoreCaret`), because the
 * caller owns the controlled value.
 *
 * Design: docs/design/aipla/v2.1.0-extension/student-notation-strip.md
 */

/** Curated from what the activities actually use (see the design doc tally),
 *  plus the three Aswin named (Δ φ ρ) that a derivation reaches for. Greek
 *  first, operators second — a stable order the student learns. */
export const PHYSICS_SYMBOLS: ReadonlyArray<{ glyph: string; name: string }> = [
  { glyph: "Δ", name: "delta" },
  { glyph: "θ", name: "theta" },
  { glyph: "φ", name: "phi" },
  { glyph: "ρ", name: "rho" },
  { glyph: "λ", name: "lambda" },
  { glyph: "ω", name: "omega" },
  { glyph: "μ", name: "my" },
  { glyph: "α", name: "alfa" },
  { glyph: "π", name: "pi" },
  { glyph: "Ω", name: "ohm" },
  { glyph: "·", name: "gange (prik)" },
  { glyph: "×", name: "gange (kryds)" },
  { glyph: "²", name: "i anden" },
  { glyph: "³", name: "i tredje" },
  { glyph: "⁻¹", name: "i minus første" },
  { glyph: "√", name: "kvadratrod" },
  { glyph: "°", name: "grader" },
  { glyph: "±", name: "plus/minus" },
  { glyph: "≈", name: "cirka lig med" },
  { glyph: "≤", name: "mindre end eller lig" },
  { glyph: "≥", name: "større end eller lig" },
  { glyph: "→", name: "pil" },
  { glyph: "∝", name: "proportional med" },
  { glyph: "∞", name: "uendelig" },
];

/** The operator names above are Danish; English activities (KineBot) get these. */
const SYMBOL_NAMES_EN: Record<string, string> = {
  μ: "mu",
  α: "alpha",
  "·": "times (dot)",
  "×": "times (cross)",
  "²": "squared",
  "³": "cubed",
  "⁻¹": "to the minus one",
  "√": "square root",
  "°": "degrees",
  "±": "plus or minus",
  "≈": "approximately",
  "≤": "less than or equal",
  "≥": "greater than or equal",
  "→": "arrow",
  "∝": "proportional to",
  "∞": "infinity",
};

const copy = {
  da: { toggle: "Fysiksymboler", show: "Vis fysiksymboler", hide: "Skjul fysiksymboler" },
  en: { toggle: "Physics symbols", show: "Show physics symbols", hide: "Hide physics symbols" },
} as const;

export type SymbolStripLang = keyof typeof copy;

function pickLang(lang: string | null | undefined): SymbolStripLang {
  return lang?.toLowerCase().startsWith("en") ? "en" : "da";
}

export const SYMBOL_STRIP_WINK_KEY = "aipla.symbolStrip.winked";
/** Long enough to read "oh, symbols", short enough not to feel like a modal. */
export const SYMBOL_STRIP_WINK_MS = 2200;

function hasWinked(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SYMBOL_STRIP_WINK_KEY) === "1";
  } catch {
    // Storage disabled (private mode) — wink every visit rather than never;
    // the cost is two seconds, the alternative is never being discovered.
    return false;
  }
}

function markWinked(): void {
  try {
    window.localStorage.setItem(SYMBOL_STRIP_WINK_KEY, "1");
  } catch {
    /* see hasWinked */
  }
}

/**
 * Open state for the strip. With `wink: true`, a device that has never seen
 * the strip gets it opened on mount and closed ~2 s later — enough to say
 * "this exists" without occupying the composer. Closed by default otherwise;
 * whether it stays open is the student's choice (no auto-close on send).
 */
export function useSymbolStrip({ wink = false }: { wink?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const winkTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!wink || hasWinked()) return;
    markWinked();
    setOpen(true);
    winkTimer.current = window.setTimeout(() => {
      winkTimer.current = null;
      setOpen(false);
    }, SYMBOL_STRIP_WINK_MS);
    return () => {
      if (winkTimer.current !== null) window.clearTimeout(winkTimer.current);
    };
  }, [wink]);

  const toggle = useCallback(() => {
    // A tap during the wink means "keep it": cancel the auto-close and leave
    // it open rather than flipping it shut under the student's finger.
    if (winkTimer.current !== null) {
      window.clearTimeout(winkTimer.current);
      winkTimer.current = null;
      setOpen(true);
      return;
    }
    setOpen((o) => !o);
  }, []);

  return { open, toggle, setOpen };
}

const iconBtn = "rounded-md border px-2 py-2 text-muted-foreground hover:text-foreground disabled:opacity-40";

export function SymbolStripToggle({
  open,
  onToggle,
  disabled,
  lang,
  controlsId,
}: {
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  lang?: string | null;
  controlsId: string;
}) {
  const c = copy[pickLang(lang)];
  const label = open ? c.hide : c.show;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-expanded={open}
      aria-controls={controlsId}
      aria-pressed={open}
      className={cn(iconBtn, "font-serif text-base leading-none", open && "border-primary text-primary")}
    >
      Ω
    </button>
  );
}

export function SymbolStrip({
  open,
  onInsert,
  disabled,
  lang,
  id,
  className,
}: {
  open: boolean;
  /** Called with the glyph; the caller inserts it at the caret. */
  onInsert: (glyph: string) => void;
  disabled?: boolean;
  lang?: string | null;
  id: string;
  className?: string;
}) {
  const l = pickLang(lang);
  if (!open) return null;
  return (
    <div
      id={id}
      role="toolbar"
      aria-label={copy[l].toggle}
      // Horizontal scroll on a phone; the row must never widen the composer.
      className={cn(
        "mb-2 flex gap-1 overflow-x-auto pb-1 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1",
        className,
      )}
    >
      {PHYSICS_SYMBOLS.map(({ glyph, name }) => {
        const label = l === "en" ? (SYMBOL_NAMES_EN[glyph] ?? name) : name;
        return (
          <button
            key={glyph}
            type="button"
            // Load-bearing: without this the click steals focus from the
            // input, the selection is lost, the glyph lands at the end, and
            // on the writing element every tap fires the blur-commit save.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(glyph)}
            disabled={disabled}
            aria-label={`${glyph} — ${label}`}
            title={`${glyph} — ${label}`}
            className="h-10 min-w-10 shrink-0 rounded-md border bg-background px-2 text-base text-foreground hover:bg-muted disabled:opacity-40"
          >
            {glyph}
          </button>
        );
      })}
    </div>
  );
}
