import type { Language } from "@/lib/teacherApi";

// Starter activity templates (1.1.38 follow-up) — realistic, classroom-ready
// activities a teacher picks and then adapts, so the builder is never a blank
// form. Between them they exercise the whole shipped feature surface: all three
// sims (Boldkast / KineBot / LED-Planck), the element palette (checklist / table
// / chart / calculator / note / solution / document) and the tutor shapes
// (Socratic dialogue, measurement lab, problem feedback). Pure data: the builder
// (`useActivityBuilder.applyTemplate`) converts these into its editor state.
//
// The physics CONTENT here is starter material for JB/AR review (same posture as
// the calculator formula set) — grounded in Danish stx fysik topics, but the
// teacher edits everything before publishing.
//
// Not carried by templates (by design): the concept-map element (applyTemplate
// resets it to null — it is showcased instead via the seeded demo class,
// `backend/onboarding/demo_seed.py`). Quiz is not a shipped workspace element.

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

export interface TemplateSolution {
  /** Teacher prompt shown above the student's rich-text solution editor. */
  prompt: string;
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
  /** Optional sim artefact to host (1.1.41) — a catalogue id. */
  artefactId?: string;
  checklist: string[];
  table?: TemplateTable;
  chart?: TemplateChart;
  calculator?: TemplateCalculator;
  note?: TemplateNote;
  /** Optional rich-text solution editor (1.1.45 M4, JB-2). */
  solution?: TemplateSolution;
  /** Optional document-upload element (1.1.48, JB-1) — the prompt above the
   *  student's upload surface. */
  document?: TemplateSolution;
}

export const ACTIVITY_TEMPLATES: ActivityTemplate[] = [
  {
    // Pure Socratic dialogue, no interactive tool — the concept-dialogue base
    // skill, made concrete around Newton's laws (the teacher re-topics freely).
    id: "concept-dialogue",
    name: "Newtons love",
    summary: "Sokratisk samtale om kraft og bevægelse — intet værktøj.",
    language: "da",
    title: "Newtons love",
    teachingGoal:
      "Hjælp eleven med at forstå Newtons tre love gennem samtale. Tag udgangspunkt i et konkret " +
      "hverdagseksempel (fx en bog på et bord, en bil der bremser, eller et raketstart). Stil " +
      "opklarende spørgsmål, der får eleven til selv at ræsonnere om kræfterne — giv ikke svaret " +
      "direkte. Hold svarene korte (højst 3 sætninger) og slut hver tur med et spørgsmål.",
    checklist: [
      "Forklar Newtons 1. lov med et eksempel",
      "Identificér kræfterne i en konkret situation",
      "Anvend Newtons 2. lov (F = m · a)",
    ],
    note: {
      title: "Newtons love",
      body:
        "**1. lov (inertiloven):** Et legeme forbliver i hvile eller jævn bevægelse, hvis " +
        "resultanten af kræfterne er nul.\n\n" +
        "**2. lov:** F = m · a — kraft giver acceleration.\n\n" +
        "**3. lov:** Til enhver kraft svarer en lige så stor, modrettet kraft.",
    },
  },
  {
    id: "energy-concept",
    name: "Energibevarelse på en rutsjebane",
    summary: "Begrebsdialog + energiberegner — hvor er energien?",
    language: "da",
    title: "Energibevarelse",
    teachingGoal:
      "Hjælp eleven med at forstå energibevarelse med en rutsjebane (eller en bold på en rampe) som " +
      "eksempel. Stil spørgsmål om, hvor energien er på forskellige tidspunkter — øverst, undervejs " +
      "og nederst — og hvordan potentiel og kinetisk energi bytter plads. Lad eleven bruge beregneren " +
      "til at finde den kinetiske energi. Konkludér ikke selv.",
    checklist: [
      "Identificér systemet og energiformerne",
      "Beskriv hvor energien er øverst og nederst",
      "Beregn den kinetiske energi og vurdér resultatet",
    ],
    calculator: {
      title: "Kinetisk energi",
      formula: "0.5 * m * v * v",
      inputs: [
        { id: "m", label: "Masse", unit: "kg" },
        { id: "v", label: "Fart", unit: "m/s" },
      ],
    },
    note: {
      title: "Energiformer",
      body:
        "**Kinetisk energi:** E_kin = ½ · m · v²\n\n" +
        "**Potentiel energi:** E_pot = m · g · h\n\n" +
        "**Bevarelse:** E_kin + E_pot er konstant (uden friktion).",
    },
  },
  {
    id: "speed-calculator",
    name: "Fart, tid og strækning",
    summary: "Formelberegner v = s / t + noteark.",
    language: "da",
    title: "Beregn fart",
    teachingGoal:
      "Hjælp eleven med at bruge sammenhængen mellem fart, strækning og tid. Tag udgangspunkt i et " +
      "konkret eksempel (fx en cykel eller en bil). Bed eleven om enhederne, før resultatet beregnes. " +
      "Forklar ikke udregningen — lad beregneren regne, og spørg ind til, om resultatet er rimeligt.",
    checklist: [
      "Identificér de kendte størrelser",
      "Omregn til SI-enheder (meter og sekunder)",
      "Indsæt i formlen og vurdér om resultatet er realistisk",
    ],
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
    // Real bench experiment (no sim) — the table/chart capture physical
    // measurements. Renamed from the generic "measurement-lab" to a concrete
    // named experiment; id kept stable.
    id: "measurement-lab",
    name: "Hookes lov — fjederkraft",
    summary: "Datatabel + graf — mål kraft mod forlængelse på bænken.",
    language: "da",
    title: "Hookes lov",
    teachingGoal:
      "Vejled eleven gennem et fjederforsøg. Bed eleven hænge forskellige lodder på fjederen, måle " +
      "forlængelsen og notere kraft og forlængelse i tabellen. Grafen viser sammenhængen. Stil " +
      "spørgsmål til, om grafen er en ret linje, og hvad hældningen (fjederkonstanten k) betyder — " +
      "konkludér ikke selv.",
    checklist: [
      "Opstil fjederen og vælg et referencepunkt",
      "Mål forlængelsen for mindst 5 forskellige kræfter",
      "Beskriv sammenhængen og aflæs fjederkonstanten fra grafen",
    ],
    table: {
      title: "Målinger",
      columns: [
        { label: "Kraft", unit: "N", kind: "number" },
        { label: "Forlængelse", unit: "m", kind: "number" },
      ],
      rows: 6,
    },
    chart: { title: "Kraft mod forlængelse", chartKind: "scatter" },
    note: {
      title: "Hookes lov",
      body:
        "**Hookes lov:** F = k · x\n\nKraften er proportional med forlængelsen. " +
        "Hældningen på grafen er fjederkonstanten k.",
    },
  },
  {
    // NEW — table + chart + calculator in one bench lab; compute g from the data.
    id: "pendulum-period",
    name: "Pendulets svingningstid",
    summary: "Datatabel + graf + beregner — find tyngdeaccelerationen g.",
    language: "da",
    title: "Pendulets svingningstid",
    teachingGoal:
      "Vejled eleven gennem et pendulforsøg. Bed eleven måle svingningstiden for forskellige " +
      "snorlængder (tag tid for 10 svingninger og divider). Lad eleven notere længde og svingningstid " +
      "i tabellen og bruge beregneren til at finde tyngdeaccelerationen g. Stil spørgsmål til, hvordan " +
      "svingningstiden afhænger af længden — konkludér ikke selv.",
    checklist: [
      "Mål svingningstiden for mindst 5 forskellige længder",
      "Notér længde og svingningstid i tabellen",
      "Beregn g og sammenlign med 9,82 m/s²",
    ],
    table: {
      title: "Målinger",
      columns: [
        { label: "Længde", unit: "m", kind: "number" },
        { label: "Svingningstid", unit: "s", kind: "number" },
      ],
      rows: 6,
    },
    chart: { title: "Svingningstid mod længde", chartKind: "scatter" },
    calculator: {
      title: "Tyngdeacceleration",
      formula: "4 * 3.14159 * 3.14159 * L / (T * T)",
      inputs: [
        { id: "L", label: "Længde", unit: "m" },
        { id: "T", label: "Svingningstid", unit: "s" },
      ],
    },
    note: {
      title: "Formel",
      body:
        "**Pendulets svingningstid:** T = 2π · √(L / g)\n\n" +
        "Deraf: **g = 4π² · L / T²** — brug beregneren til at finde g ud fra dine målinger.",
    },
  },
  {
    // 1.1.38 → 1.1.41: projectile-motion companion to the Boldkast sim.
    id: "projectile-motion",
    name: "Kastebevægelse — den optimale vinkel",
    summary: "Boldkast-simulation + datatabel + graf — vinkel vs. rækkevidde.",
    language: "da",
    title: "Kastebevægelse",
    artefactId: "boldkast",
    teachingGoal:
      "Hjælp eleven med at undersøge kastebevægelse med Boldkast-simulationen. Bed eleven variere " +
      "udgangsvinklen, aflæse rækkevidden og notere den i tabellen. Stil spørgsmål til sammenhængen " +
      "mellem vinkel og rækkevidde — konkludér ikke selv, men lad eleven opdage, hvilken vinkel der " +
      "giver den største rækkevidde.",
    checklist: [
      "Mål rækkevidden for mindst 5 forskellige vinkler",
      "Find vinklen med størst rækkevidde",
      "Forklar hvorfor netop den vinkel er optimal",
    ],
    table: {
      title: "Forsøg",
      columns: [
        { label: "Vinkel", unit: "°", kind: "number" },
        { label: "Rækkevidde", unit: "m", kind: "number" },
      ],
      rows: 6,
    },
    chart: { title: "Rækkevidde mod vinkel", chartKind: "scatter" },
    note: {
      title: "Tip",
      body:
        "Brug **Boldkast**-simulationen til at variere vinklen og aflæse rækkevidden.\n\n" +
        "Husk: den vandrette og den lodrette bevægelse er uafhængige.",
    },
  },
  {
    // NEW — the KineBot sim (kinematics + motion graphs). No template used it
    // before, though the sim ships live.
    id: "motion-graphs",
    name: "Bevægelsesgrafer — aflæs og fortolk",
    summary: "KineBot-simulation — sted, fart og acceleration hænger sammen.",
    language: "da",
    title: "Bevægelsesgrafer",
    artefactId: "kinebot",
    teachingGoal:
      "Hjælp eleven med at aflæse og fortolke bevægelsesgrafer med KineBot-simulationen. Bed eleven " +
      "ændre bevægelsens parametre og se, hvordan sted-, fart- og accelerationsgraferne hænger sammen. " +
      "Stil spørgsmål som 'hvilken graf viser konstant acceleration?' og 'hvad sker der med farten, når " +
      "accelerationen er nul?' — lad eleven selv aflæse graferne og drage konklusionerne.",
    checklist: [
      "Undersøg en bevægelse med konstant fart",
      "Undersøg en bevægelse med konstant acceleration",
      "Forklar sammenhængen mellem de tre grafer",
    ],
    note: {
      title: "Bevægelsesgrafer",
      body:
        "**Sted (s–t):** hældningen er farten.\n\n" +
        "**Fart (v–t):** hældningen er accelerationen; arealet er strækningen.\n\n" +
        "**Acceleration (a–t):** arealet er ændringen i fart.",
    },
  },
  {
    // NEW — the LED-Planck virtual lab (quantum / stx fysik A). The most
    // sophisticated sim, previously in no template.
    id: "planck-constant",
    name: "Bestem Plancks konstant",
    summary: "LED-virtuallab + datatabel + graf — mål tændspænding, find h.",
    language: "da",
    title: "Bestem Plancks konstant",
    artefactId: "led-planck",
    teachingGoal:
      "Vejled eleven gennem det virtuelle LED-forsøg til bestemmelse af Plancks konstant. Bed eleven " +
      "vælge forskellige LED-bølgelængder, skrue op for spændingen til lysdioden netop tænder, og " +
      "notere tændspændingen i tabellen. Stil spørgsmål til sammenhængen mellem bølgelængde og " +
      "tændspænding — afslør ikke formlen, men lad eleven selv finde, hvordan h kan beregnes.",
    checklist: [
      "Mål tændspændingen for mindst 4 forskellige bølgelængder",
      "Notér bølgelængde og tændspænding i tabellen",
      "Undersøg sammenhængen og beregn Plancks konstant",
    ],
    table: {
      title: "Målinger",
      columns: [
        { label: "Bølgelængde", unit: "nm", kind: "number" },
        { label: "Tændspænding", unit: "V", kind: "number" },
      ],
      rows: 5,
    },
    chart: { title: "Tændspænding mod bølgelængde", chartKind: "scatter" },
    note: {
      title: "Sammenhæng",
      body:
        "**Fotonenergi:** E = h · c / λ = e · U\n\n" +
        "Deraf kan Plancks konstant h findes ud fra tændspændingen U og bølgelængden λ.",
    },
  },
  {
    // 1.1.45 M4 → image-based 1.1.48 M1 (JB-2): the student photographs their
    // own pen-and-paper solution and the tutor gives Socratic feedback on it.
    id: "solution-writing",
    name: "Din løsning",
    summary: "Eleven fotograferer sin løsning — tutoren giver feedback (aldrig svaret).",
    language: "da",
    title: "Din løsning",
    teachingGoal:
      "Hjælp eleven med at forbedre sin egen løsning (et foto af håndskrevet arbejde). Giv aldrig den " +
      "fulde løsning — peg på, hvor et skridt, en værdi eller en formel er forkert, og stil et spørgsmål, " +
      "så eleven selv kan rette den. Ros først ét rigtigt skridt, og fokusér så på det vigtigste, der " +
      "mangler. Tjek fysikken — enheder, fortegn, om resultatet er realistisk — ikke kun algebraen.",
    checklist: ["Skriv din løsning med udregninger", "Forklar dine skridt", "Tjek enheder og fortegn"],
    solution: {
      prompt: "Tag et billede af din håndskrevne løsning — vis dine udregninger og forklar dine skridt.",
    },
    note: {
      title: "Tip",
      body:
        "Skriv din løsning på papir med alle udregninger, og tag et tydeligt billede.\n\n" +
        "Tutoren giver feedback på din fremgangsmåde — ikke bare facit.",
    },
  },
  {
    // 1.1.45 M3b (JB-1) — document feedback: the student uploads their own
    // file(s) and the tutor critiques the active one. A composable document
    // element (1.1.48) — can carry a checklist/note alongside if the teacher adds.
    id: "document-feedback",
    name: "Dokumentfeedback",
    summary: "Eleven uploader sit eget arbejde — tutoren giver feedback på filen.",
    language: "da",
    title: "Dokumentfeedback",
    teachingGoal:
      "Hjælp eleven med at forbedre det dokument, de har uploadet. Tag udgangspunkt i den aktive fil. Giv " +
      "aldrig det fulde svar — peg på, hvor noget er forkert eller mangler, og stil et spørgsmål, så eleven " +
      "selv kan rette det. Ros først noget, der virker, og fokusér så på det vigtigste at forbedre.",
    checklist: ["Upload dit arbejde", "Læs tutorens feedback", "Ret det vigtigste og upload igen"],
    document: { prompt: "Upload et billede eller en fil af dit arbejde, så giver tutoren feedback." },
  },
  {
    // 1.1.57 M2 (RUBRIC-1) — the SAAR agent-design activity: the student
    // designs an AI agent's instructions, then designs test cases that could
    // REFUTE it (the Etkina testing-experiment mechanic, chat-first — the
    // tutor guides the loop conversationally). The SAAR judge (Lens D) scores
    // the transcript post-hoc, researcher-side.
    id: "agent-design",
    name: "Design din egen agent",
    summary: "Eleven designer en AI-agent og tester den med forsøg, der kan AFVISE den.",
    language: "da",
    title: "Design din egen agent",
    teachingGoal:
      "Eleven designer en lille AI-agent (en instruks for, hvad agenten skal kunne) og afprøver den " +
      "videnskabeligt. Vejled eleven gennem faserne: (1) formulér hvad agenten SKAL kunne som en hypotese, " +
      "(2) design testtilfælde, der kunne AFVISE agenten — ikke kun bekræfte den, (3) forudsig resultatet " +
      "af hver test FØR den køres, (4) gennemgå testene i samtalen og sammenlign forudsigelse med udfald, " +
      "(5) identificér antagelser og revidér agent-instruksen. Det afgørende er refutationstankegangen: " +
      "spørg altid 'hvilket udfald ville vise, at din agent IKKE virker?'. Konkludér ikke for eleven.",
    checklist: [
      "Formulér hvad din agent skal kunne (hypotesen)",
      "Design mindst 3 testtilfælde — mindst ét der kan afvise agenten",
      "Forudsig udfaldet af hver test, før du kører den",
      "Sammenlign forudsigelse og udfald",
      "Notér dine antagelser, og revidér agenten",
    ],
    note: {
      title: "Videnskabelig test af din agent",
      body:
        "En god test er en, der KAN gå galt. Hvis alle dine tests bare bekræfter det, du allerede " +
        "troede, har du ikke testet noget.\n\n" +
        "Skriv din agent-instruks i chatten, og design så dine tests sammen med tutoren.",
    },
  },
];
