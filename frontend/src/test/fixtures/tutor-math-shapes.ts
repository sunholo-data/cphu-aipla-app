// 1.1.147 M0 — the maths shapes the tutor actually sent.
//
// REAL: tutor turns from the 2026-10-05 teacher seminar on prod
// (gemini-3.5-flash-lite), anonymised — no group, session or activity ids.
// Some are excerpts ("…"); the maths is verbatim. SYNTHETIC: the delimiter rows
// of the design doc's "verified behaviour" table.
//
// `minKatex` is the number of formulas that must typeset; `allowedSource` lists
// source fragments that legitimately remain (e.g. a code span naming `\cdot`
// that is NOT whole-maths and must stay code).

export interface TutorMathShape {
  name: string;
  source: "prod-2026-10-05" | "synthetic";
  content: string;
  minKatex: number;
  /** Text that may remain as literal source because it is not maths. */
  allowedSource?: string[];
}

export const TUTOR_MATH_SHAPES: TutorMathShape[] = [
  {
    name: "backtick-wrapped maths — Effekt og nyttevirkning (1)",
    source: "prod-2026-10-05",
    content:
      "Prøv at regne den tilførte elektriske energi `$E_{\\text{el}}$` ud ved at gange `$P$` med `$t$`, og husk at effekten er i watt (joule pr. sekund) og tiden er i sekunder – hvad giver det for et samlet energiforbrug i joule?",
    minKatex: 3,
  },
  {
    name: "backtick-wrapped maths with a leading `\\cdot` code span — Effekt og nyttevirkning (2)",
    source: "prod-2026-10-05",
    content:
      "`\\cdot` er bare et gangetegn, så `$m \\cdot c \\cdot \\Delta T$` betyder det samme som `$m \\times c \\times \\Delta T$`.",
    minKatex: 2,
    // The span is the tutor naming the command, not a formula: it stays code.
    allowedSource: ["\\cdot"],
  },
  {
    name: "backtick-wrapped maths — Mekanisk energi",
    source: "prod-2026-10-05",
    content:
      "Det er et fint udgangspunkt med en masse på `$350 \\text{ g}$` og en højde på `$21 \\text{ cm}$`. Før vi sætter dem ind i formlen `$E_{\\text{pot}} = m \\cdot g \\cdot h$`, er der så nogle enheder, vi skal have lavet om, for at energien kommer ud i joule?",
    minKatex: 3,
  },
  {
    name: "degree sign inside \\text{} — KaTeX parse error",
    source: "prod-2026-10-05",
    content:
      "To get us started, what happens to the temperature of $100\\text{ g}$ of ice at $-20\\text{ ^\\circ C}$ when you begin supplying energy to it with a constant power source?",
    minKatex: 2,
  },
  {
    name: "\\celsius inside \\text{} — siunitx, not KaTeX",
    source: "prod-2026-10-05",
    content:
      "…hvor du varmede $0{,}5\\text{ kg}$ vand op til $100{,}0\\text{ \\celsius}$ over $260{,}4\\text{ s}$ med en effekt på $1300\\text{ W}$.",
    minKatex: 4,
  },
  {
    name: "\\(…\\) delimiters",
    source: "prod-2026-10-05",
    content: "…imagine you take \\(100\\text{ g}\\) of ice at \\(-20^\\circ\\text{C}\\) and turn on a heater…",
    minKatex: 2,
  },
  {
    name: "\\(…\\) with a fraction",
    source: "synthetic",
    content: "Farten er \\(v = \\frac{s}{t}\\).",
    minKatex: 1,
  },
  {
    name: "\\[…\\] on one line",
    source: "synthetic",
    content: "Energien er \\[E = mc^2\\]",
    minKatex: 1,
  },
  {
    name: "\\[…\\] across lines",
    source: "synthetic",
    content: "Energien er\n\\[\nE = P \\cdot t\n\\]\nså regn den ud.",
    minKatex: 1,
  },
  {
    name: "plain $…$ with a {,} decimal (already worked)",
    source: "synthetic",
    content: "Farten er $v = 0{,}2 \\text{ m/s}$.",
    minKatex: 1,
  },
  {
    name: "$…$ in a GFM table cell (already worked)",
    source: "synthetic",
    content: "| Størrelse | Værdi |\n| --- | --- |\n| $v_0$ | $2\\text{ m/s}$ |",
    minKatex: 2,
  },
];

/** Fragments that mean the student is reading LaTeX source. */
export const SOURCE_FRAGMENTS = ["$", "\\cdot", "\\frac", "\\text", "\\celsius", "\\(", "\\["];
