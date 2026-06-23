import type { Language } from "@/lib/teacherApi";

// Starter activity templates (1.1.38 follow-up) — quick defaults a teacher picks
// and then modifies, so the builder is never a blank form. Each showcases a
// different slice of the element palette (checklist / table / chart / calculator
// / note). Pure data: the builder converts these into its editor state.
//
// The physics CONTENT here is starter material for JB/AR review (same posture as
// the calculator formula set) — the value is the quick-default affordance; the
// teacher edits everything before publishing.

export interface TemplateTable {
  title: string;
  columns: { label: string; unit?: string; kind: "number" | "text" }[];
  rows: number;
}

export interface TemplateChart {
  title: string;
  chartKind: "scatter" | "line" | "bar";
}

export interface TemplateCalculator {
  title: string;
  formula: string;
  inputs: { id: string; label: string; unit?: string }[];
}

export interface TemplateNote {
  title: string;
  body: string;
}

export interface ActivityTemplate {
  /** Stable id (for the picker key + tests). */
  id: string;
  /** Picker label. */
  name: string;
  /** One-line description shown under the name. */
  summary: string;
  language: Language;
  /** Suggested activity title (the teacher renames). */
  title: string;
  teachingGoal: string;
  checklist: string[];
  table?: TemplateTable;
  chart?: TemplateChart;
  calculator?: TemplateCalculator;
  note?: TemplateNote;
}

export const ACTIVITY_TEMPLATES: ActivityTemplate[] = [
  {
    id: "concept-dialogue",
    name: "Begrebsdialog",
    summary: "Ren sokratisk samtale — intet værktøj.",
    language: "da",
    title: "Ny begrebsdialog",
    teachingGoal:
      "Hjælp eleven med at udforske emnet gennem spørgsmål. Giv ikke svaret direkte — stil opklarende " +
      "spørgsmål, der får eleven til selv at ræsonnere. Hold svarene korte (højst 3 sætninger) og slut " +
      "hver tur med et spørgsmål.",
    checklist: ["Forklar begrebet med egne ord", "Giv et eksempel fra hverdagen"],
  },
  {
    id: "measurement-lab",
    name: "Måleforsøg med graf",
    summary: "Datatabel + graf — eleven måler og plotter.",
    language: "da",
    title: "Måleforsøg",
    teachingGoal:
      "Vejled eleven gennem forsøget. Bed eleven indtaste sine målinger i tabellen og aflæse grafen. " +
      "Stil spørgsmål til sammenhængen mellem variablene i stedet for at konkludere selv.",
    checklist: ["Opstil forsøget", "Foretag mindst 5 målinger", "Beskriv sammenhængen i grafen"],
    table: {
      title: "Målinger",
      columns: [
        { label: "Tid", unit: "s", kind: "number" },
        { label: "Position", unit: "m", kind: "number" },
      ],
      rows: 6,
    },
    chart: { title: "Position mod tid", chartKind: "scatter" },
  },
  {
    id: "speed-calculator",
    name: "Beregning",
    summary: "Formelberegner + noteark — fx fart v = s / t.",
    language: "da",
    title: "Beregn fart",
    teachingGoal:
      "Hjælp eleven med at bruge formlen korrekt. Bed eleven om enhederne, før resultatet beregnes. " +
      "Forklar ikke udregningen — lad beregneren regne, og spørg ind til, om resultatet er rimeligt.",
    checklist: ["Identificér de kendte størrelser", "Indsæt i formlen", "Vurdér om resultatet er realistisk"],
    calculator: {
      title: "Fart",
      formula: "s / t",
      inputs: [
        { id: "s", label: "Strækning", unit: "m" },
        { id: "t", label: "Tid", unit: "s" },
      ],
    },
    note: {
      title: "Formel",
      body: "**Fart:** v = s / t\n\nHusk at omregne til SI-enheder (meter og sekunder), før du regner.",
    },
  },
  {
    id: "energy-concept",
    name: "Energibevarelse",
    summary: "Begrebsdialog med formelnoter.",
    language: "da",
    title: "Energibevarelse",
    teachingGoal:
      "Hjælp eleven med at forstå energibevarelse. Tag udgangspunkt i et konkret eksempel (fx en pendul " +
      "eller en bold på en rampe). Stil spørgsmål om, hvor energien er på forskellige tidspunkter — " +
      "konkludér ikke selv.",
    checklist: ["Identificér systemet", "Beskriv energiformerne", "Anvend energibevarelse"],
    note: {
      title: "Energiformer",
      body:
        "**Kinetisk energi:** E_kin = ½ · m · v²\n\n" +
        "**Potentiel energi:** E_pot = m · g · h\n\n" +
        "**Bevarelse:** E_kin + E_pot er konstant (uden friktion).",
    },
  },
];
