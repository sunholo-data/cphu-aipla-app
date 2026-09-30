import type { Language } from "@/lib/teacherApi";

// Starter activity templates (1.1.38 follow-up) — realistic, classroom-ready
// activities a teacher picks and then adapts, so the builder is never a blank
// form. Between them they exercise the whole shipped feature surface: all three
// sims (Boldkast / KineBot / LED-Planck), the element palette (checklist / table
// / chart / calculator / note / writing / solution / document) and the tutor shapes
// (Socratic dialogue, measurement lab, problem feedback). Pure data: the builder
// (`useActivityBuilder.applyTemplate`) converts these into its editor state.
//
// The physics CONTENT here is starter material for JB/AR review (same posture as
// the calculator formula set) — grounded in Danish stx fysik topics, but the
// teacher edits everything before publishing.
//
// Concept maps ARE carried (applyTemplate copies them) — and most maps on prod
// are template copies, so a template's node labels are what students see. The
// questionSet element (ratings / multiple choice / free text, 1.1.78) is
// designed but not yet shipped — add a template once its M0 lands.

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

export interface TemplateWriting {
  title: string;
  /** The task shown above the box. */
  prompt: string;
  /** Word target shown to the student; never a save gate. */
  minWords?: number;
}

export interface TemplateConceptQuestion {
  prompt: string;
  expectedAnswer: string;
}

export interface TemplateConceptNode {
  /** Stable slug — edges + checkpoint state key on it. */
  id: string;
  label: string;
  /** Prerequisite node ids (must be demonstrated first); forms the DAG. */
  dependsOn?: string[];
  /** The definition of done (CONCEPT-2 M1) — what counts as having got it.
   *  Templates carry one because they are where nearly every map on prod comes
   *  from: of the 56 activities with a concept map on 2026-09-25, 55 were
   *  template copies and one was authored by hand. A template without a bar
   *  teaches teachers that a map does not need one. */
  doneWhen?: string;
  questions?: TemplateConceptQuestion[];
}

export interface TemplateConceptMap {
  title: string;
  nodes: TemplateConceptNode[];
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
  /** Optional school subject (a `SUBJECTS` value, e.g. "Fysik", "Matematik").
   *  Unset leaves whatever the builder already holds. Added 2026-09-28 with
   *  the first maths sim, which would otherwise be filed under no subject. */
  subject?: string;
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
  /** Optional student writing surfaces (1.1.73). A LIST, not a single slot:
   *  the cap is 3 and a lab report wanting both a method and a conclusion box
   *  is the obvious first ask. `chart` is singular here and 1.1.64/1.1.71 had
   *  to un-pick exactly that; not making it a third time. */
  writing?: TemplateWriting[];
  /** Optional living concept map (living-concept-map M0) — a prerequisite DAG
   *  over the activity's concepts + per-node chat-native check questions the
   *  tutor runs as checkpoints. */
  conceptMap?: TemplateConceptMap;
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
    conceptMap: {
      title: "Energibevarelse",
      nodes: [
        {
          id: "kinetisk",
          label: "Kinetisk energi",
          doneWhen: "kan forklare, at E_kin vokser med massen og med kvadratet på farten",
          questions: [
            {
              prompt: "Hvad afhænger den kinetiske energi af?",
              expectedAnswer: "massen m og farten v: E_kin = ½·m·v²",
            },
          ],
        },
        {
          id: "potentiel",
          label: "Potentiel energi",
          doneWhen: "kan forklare, at E_pot afhænger af massen og af højden over nulpunktet",
          questions: [
            {
              prompt: "Hvad afhænger den potentielle energi af?",
              expectedAnswer: "massen m, tyngden g og højden h: E_pot = m·g·h",
            },
          ],
        },
        {
          id: "bevarelse",
          label: "Energibevarelse",
          doneWhen: "kan følge energien gennem et forløb og vise, at summen er den samme før og efter",
          dependsOn: ["kinetisk", "potentiel"],
          questions: [
            {
              prompt: "Hvad sker der med summen af kinetisk og potentiel energi uden friktion?",
              expectedAnswer: "den er konstant — energien omdannes mellem formerne, men bevares",
            },
          ],
        },
      ],
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
    // 1.1.73 — the lab arc used to stop at the graph. The conclusion is where
    // the physics actually happens, and the tutor can see BOTH the table the
    // student filled and the text they wrote about it.
    writing: [
      {
        title: "Konklusion",
        prompt:
          "Skriv jeres konklusion: Er kraften proportional med forlængelsen? Hvad viser hældningen, " +
          "og hvad er fjederkonstanten k for jeres fjeder? Nævn mindst én kilde til usikkerhed.",
        minWords: 100,
      },
    ],
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
    // Error-analysis lab: the handed-out dataset has ONE planted error; the
    // student re-runs the experiment and the tutor guides them to find it. The
    // error + its location live in `teachingGoal` (tutor-visible, student-hidden);
    // the student sees only the data in the note. Uses the shipped note + empty
    // table — seeded editable table cells are a future extension (offline-lab
    // 1.1.24 adds deterministic ground-truth checking on top of this).
    id: "measurement-error",
    name: "Find fejlen i måledata",
    summary: "Datatabel + graf — én måling er forkert; eleven gentager forsøget og finder fejlen.",
    language: "da",
    title: "Find fejlen i måledata",
    teachingGoal:
      "Eleven har fået et datasæt fra en tidligere gruppe (vist i noten) for en vogn, der kører med " +
      "konstant fart (ca. 0,20 m/s, så position = 0,20 · tid). ÉN måling er forkert: ved tiden t = 3,0 s " +
      "står positionen til 0,90 m, men den burde være ca. 0,60 m. AFSLØR IKKE hvilken måling der er " +
      "forkert. Bed eleven gentage forsøget selv, indtaste sine egne målinger i tabellen og sammenligne " +
      "med det udleverede datasæt. Stil spørgsmål: passer alle punkter på en ret linje? Hvilket punkt " +
      "afviger? Hvad kunne årsagen være (aflæsningsfejl, forkert tidtagning)? Lad eleven selv opdage og " +
      "begrunde fejlen — konkludér ikke for eleven.",
    checklist: [
      "Gentag forsøget og indtast dine egne målinger i tabellen",
      "Sammenlign dine data med det udleverede datasæt",
      "Find den måling der afviger, og forklar hvorfor",
    ],
    table: {
      title: "Dine målinger",
      columns: [
        { label: "Tid", unit: "s", kind: "number" },
        { label: "Position", unit: "m", kind: "number" },
      ],
      rows: 5,
    },
    chart: { title: "Position mod tid", chartKind: "scatter" },
    note: {
      title: "Udleveret datasæt",
      body:
        "En tidligere gruppe lod en vogn køre med konstant fart og målte positionen til forskellige tider:\n\n" +
        "| Tid (s) | Position (m) |\n" +
        "|---|---|\n" +
        "| 1,0 | 0,20 |\n" +
        "| 2,0 | 0,40 |\n" +
        "| 3,0 | 0,90 |\n" +
        "| 4,0 | 0,80 |\n" +
        "| 5,0 | 1,00 |\n\n" +
        "Én af målingerne ser forkert ud. Gentag forsøget selv, og find ud af hvilken.",
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
    conceptMap: {
      title: "Kastebevægelse",
      nodes: [
        {
          id: "vektorer",
          label: "Vektorer",
          doneWhen: "kan opdele en starthastighed i en vandret og en lodret komposant uden hjælp",
          questions: [
            {
              prompt: "Hvordan finder du den vandrette og lodrette del af starthastigheden ved 30°?",
              expectedAnswer: "vx = v0·cos(30°), vy = v0·sin(30°) — dekomponering med cos og sin",
            },
          ],
        },
        {
          id: "trigonometri",
          label: "Trigonometri",
          doneWhen: "kan begrunde valget af cosinus og sinus ud fra trekanten, ikke fra en huskeregel",
          questions: [
            {
              prompt: "Hvorfor bruger vi cosinus til den vandrette komposant og sinus til den lodrette?",
              expectedAnswer:
                "cos giver den hosliggende (vandrette) katete, sin den modstående (lodrette) i trekanten",
            },
          ],
        },
        {
          id: "projektilbevaegelse",
          label: "Projektilbevægelse",
          doneWhen: "kan forklare parablen ud fra, at x-retningen har konstant fart og y-retningen konstant acceleration",
          dependsOn: ["vektorer", "trigonometri"],
          questions: [
            {
              prompt: "Hvorfor er banen en parabel — hvad sker der i x- og y-retningen hver for sig?",
              expectedAnswer: "x: konstant hastighed; y: konstant acceleration nedad — tilsammen en parabel",
            },
            {
              prompt: "Hvilken vinkel giver størst rækkevidde uden luftmodstand, og hvorfor?",
              expectedAnswer: "45° — bedste balance mellem flyvetid (sin) og vandret fart (cos)",
            },
          ],
        },
      ],
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
    conceptMap: {
      title: "Bevægelsesgrafer",
      nodes: [
        {
          id: "fart",
          label: "Fart",
          doneWhen: "kan aflæse en fart som hældningen på en sted-tid-graf og sige hvad en stejlere kurve betyder",
          questions: [
            {
              prompt: "Hvad fortæller hældningen på en sted-tid-graf?",
              expectedAnswer: "farten (hastigheden) — jo stejlere kurve, jo større fart",
            },
          ],
        },
        {
          id: "acceleration",
          label: "Acceleration",
          doneWhen: "kan aflæse en acceleration som hældningen på en fart-tid-graf",
          questions: [
            {
              prompt: "Hvad fortæller hældningen på en fart-tid-graf?",
              expectedAnswer: "accelerationen — ændringen i fart pr. tid",
            },
          ],
        },
        {
          id: "grafer",
          label: "Bevægelsesgrafer",
          doneWhen: "kan skifte mellem sted-, fart- og accelerationsgrafer for den samme bevægelse",
          dependsOn: ["fart", "acceleration"],
          questions: [
            {
              prompt: "Hvordan ser fart-tid-grafen ud, når accelerationen er konstant?",
              expectedAnswer: "en ret linje med konstant hældning",
            },
          ],
        },
      ],
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
  // ── The catalogue-only sims (2026-09-28) ────────────────────────────────
  // One starter per sim that shipped after the three above. Four rules hold
  // for all six, and the tests beside this file pin them:
  //   * No CALCULATOR for the quantity the sim withholds. Each of these sims
  //     hides one result (wave speed, efficiency, a slope) because working it
  //     out IS the exercise; a calculator with that formula hands it back.
  //   * The goal describes the method and never restates the reference
  //     values. Those live in the sim's tutorBlock (server-side, one copy);
  //     a second copy here would drift and is readable by any teacher.
  //   * Concept-map LABELS are shown to the student from the first minute,
  //     "not yet" nodes included, so they name what the student will DO or
  //     OBSERVE — never the conclusion the tutor is told not to state.
  //   * `subject` is set, so a maths sim lands under Matematik.
  {
    id: "kettle-efficiency",
    name: "Elkedlens nyttevirkning",
    summary: "Elkedel-simulation + datatabel + graf — hvor meget af energien ender i vandet?",
    language: "da",
    subject: "Fysik",
    title: "Elkedlens nyttevirkning",
    artefactId: "kettle-efficiency",
    teachingGoal:
      "Hjælp eleven med at bestemme elkedlens nyttevirkning. Eleven vælger effekt og vandmængde, varmer " +
      "vandet op og registrerer aflæsningerne: energimåleren, start- og sluttemperatur og tiden. Lad eleven " +
      "selv finde ud af, hvilken energi måleren tæller, og hvordan man regner den energi ud, vandet har " +
      "modtaget. Regn ikke for eleven, og bekræft ikke et facit — spørg, hvilken energi der står over og " +
      "under brøkstregen, og hvor resten af energien er blevet af.",
    checklist: [
      "Lav mindst 3 opvarmninger med forskellig effekt eller vandmængde",
      "Notér aflæsningerne i tabellen",
      "Beregn den energi, vandet har modtaget",
      "Beregn nyttevirkningen for hver opvarmning",
      "Forklar, hvor den resterende energi bliver af",
    ],
    table: {
      title: "Opvarmninger",
      columns: [
        { label: "Effekt", unit: "W", kind: "number" },
        { label: "Vandmængde", unit: "L", kind: "number" },
        { label: "Temperaturstigning", unit: "°C", kind: "number" },
        { label: "Energi fra måleren", unit: "kWh", kind: "number" },
        { label: "Nyttevirkning", kind: "number" },
      ],
      rows: 5,
    },
    chart: { title: "Nyttevirkning mod effekt", chartKind: "scatter" },
    writing: [
      {
        title: "Konklusion",
        prompt:
          "Afhænger nyttevirkningen af effekten eller vandmængden? Henvis til jeres målinger, og forklar, " +
          "hvor den energi, der ikke ender i vandet, bliver af.",
        minWords: 80,
      },
    ],
    note: {
      title: "Tip",
      body:
        "Energimåleren viser **kWh**. Husk at omregne, før du sammenligner med energi i **J**.\n\n" +
        "Vands specifikke varmekapacitet står i din formelsamling. Regn med, at 1 L vand vejer 1 kg.",
    },
    conceptMap: {
      title: "Elkedlens nyttevirkning",
      nodes: [
        {
          id: "tilfoert-energi",
          label: "Energien fra stikkontakten",
          doneWhen: "kan aflæse energimåleren og omregne kWh til J uden hjælp",
          questions: [
            {
              prompt: "Hvor mange joule er 0,05 kWh?",
              expectedAnswer: "0,05 · 3,6·10⁶ J = 1,8·10⁵ J (1 kWh = 3,6 MJ)",
            },
          ],
        },
        {
          id: "energi-til-vandet",
          label: "Energien til vandet",
          doneWhen: "kan beregne den energi vandet modtager ud fra masse, temperaturstigning og specifik varmekapacitet",
          questions: [
            {
              prompt: "Hvilke tre størrelser skal du bruge for at regne den energi ud, vandet har fået?",
              expectedAnswer: "massen, temperaturstigningen og vands specifikke varmekapacitet: E = c·m·ΔT",
            },
          ],
        },
        {
          id: "nyttevirkning",
          label: "Nyttevirkning",
          dependsOn: ["tilfoert-energi", "energi-til-vandet"],
          doneWhen: "kan stille brøken op med den nyttige energi øverst og forklare, hvorfor den er under 1",
          questions: [
            {
              prompt: "Hvilken energi står over brøkstregen, og hvilken står under — og hvorfor?",
              expectedAnswer: "nyttig energi (til vandet) over tilført energi (fra måleren); resten går til kedlen og omgivelserne",
            },
          ],
        },
      ],
    },
  },
  {
    id: "phase-change",
    name: "Opvarmningskurven — fra is til damp",
    summary: "Faseovergangs-simulation + datatabel + graf — hvorfor står temperaturen stille?",
    language: "da",
    subject: "Fysik",
    title: "Opvarmningskurven",
    artefactId: "phase-change",
    teachingGoal:
      "Hjælp eleven med at undersøge, hvad der sker, når 100 g is varmes op til damp. Bed eleven markere " +
      "punkter på kurven i hver fase og ved begyndelsen og slutningen af de vandrette stykker, og notere " +
      "tilført energi og temperatur. Stil spørgsmål til, hvor energien går hen, når temperaturen ikke " +
      "stiger — forklar det ikke selv. Når eleven har afgrænset begge plateauer, så spørg, hvordan de to " +
      "kan sammenlignes. Giv ikke eleven konstanterne; lad dem bestemme dem ud fra deres egne punkter.",
    checklist: [
      "Markér mindst to punkter i hver fase",
      "Markér begyndelsen og slutningen af hvert vandret stykke",
      "Bestem, hvor meget energi hvert vandret stykke kræver",
      "Sammenlign de to vandrette stykker",
      "Forklar, hvor energien går hen, når temperaturen står stille",
    ],
    table: {
      title: "Punkter på kurven",
      columns: [
        { label: "Tilført energi", unit: "kJ", kind: "number" },
        { label: "Temperatur", unit: "°C", kind: "number" },
        { label: "Fase", kind: "text" },
      ],
      rows: 10,
    },
    chart: { title: "Temperatur mod tilført energi", chartKind: "scatter" },
    writing: [
      {
        title: "Forklaring",
        prompt:
          "Hvorfor stiger temperaturen ikke ved 0 °C og 100 °C, selv om der hele tiden tilføres energi? " +
          "Hvorfor er det ene vandrette stykke meget længere end det andet? Brug jeres egne målinger.",
        minWords: 80,
      },
    ],
    note: {
      title: "Tip",
      body:
        "Ét punkt på kurven fortæller ikke meget. **To punkter** afgrænser et stykke af kurven — " +
        "forskellen i energi mellem dem er det, stykket har kostet.",
    },
    conceptMap: {
      title: "Opvarmningskurven",
      nodes: [
        {
          id: "aflaese-kurven",
          label: "Aflæse kurven",
          doneWhen: "kan finde den energi, et stykke af kurven kræver, som forskellen mellem to markerede punkter",
          questions: [
            {
              prompt: "Hvordan finder du ud af, hvor meget energi et bestemt stykke af kurven har krævet?",
              expectedAnswer: "markér et punkt i hver ende og træk den tilførte energi fra hinanden",
            },
          ],
        },
        {
          id: "en-fase",
          label: "Opvarmning af én fase",
          dependsOn: ["aflaese-kurven"],
          doneWhen: "kan forklare, at energien i en skrå del går til temperaturstigning, og bestemme hældningens betydning",
          questions: [
            {
              prompt: "Hvorfor er kurven stejlere for is og damp end for flydende vand?",
              expectedAnswer: "vand har større specifik varmekapacitet, så samme energi giver mindre temperaturstigning",
            },
          ],
        },
        {
          id: "plateauer",
          label: "De vandrette stykker",
          dependsOn: ["aflaese-kurven"],
          doneWhen: "kan forklare, at energien ved et plateau bruges til faseovergangen og ikke til temperaturstigning",
          questions: [
            {
              prompt: "Hvor går energien hen, mens temperaturen står stille ved 0 °C?",
              expectedAnswer: "den bruges til at bryde bindingerne mellem molekylerne — isen smelter (smeltevarme)",
            },
          ],
        },
        {
          id: "sammenligne-plateauer",
          label: "Sammenligne de to vandrette stykker",
          dependsOn: ["plateauer"],
          doneWhen: "kan bestemme begge plateauers energi ud fra egne målinger og begrunde, hvorfor fordampning kræver mest",
          questions: [
            {
              prompt: "Hvorfor kræver det meget mere energi at fordampe vandet end at smelte isen?",
              expectedAnswer:
                "ved fordampning skal molekylerne helt fri af hinanden; ved smeltning skal de kun kunne bevæge sig",
            },
          ],
        },
      ],
    },
  },
  {
    id: "wave-speed",
    name: "Bølgefart — hvor hurtigt løber bølgen?",
    summary: "Bølge-simulation + datatabel + graf — aflæs f, λ og T og find bølgens fart.",
    language: "da",
    subject: "Fysik",
    title: "Bølgefart",
    artefactId: "wave-speed",
    teachingGoal:
      "Hjælp eleven med at finde bølgens fart ud fra det, simulationen viser: frekvens, bølgelængde og " +
      "periode. Simulationen viser aldrig farten, og det skal du heller ikke. Spørg, hvad eleven har målt, " +
      "og hvad de tror, de skal gøre med tallene. Lad eleven selv opdage sammenhængen mellem periode og " +
      "frekvens ud fra deres tabel. Regn ikke for eleven.",
    checklist: [
      "Registrér mindst 4 målinger med forskellige indstillinger",
      "Find en sammenhæng mellem periode og frekvens",
      "Beregn bølgens fart for hver måling",
      "Forklar, hvordan du fandt farten",
    ],
    table: {
      title: "Målinger",
      columns: [
        { label: "Frekvens f", unit: "Hz", kind: "number" },
        { label: "Bølgelængde λ", unit: "m", kind: "number" },
        { label: "Periode T", unit: "s", kind: "number" },
        { label: "Fart", unit: "m/s", kind: "number" },
      ],
      rows: 5,
    },
    chart: { title: "Periode mod frekvens", chartKind: "scatter" },
    writing: [
      {
        title: "Forklaring",
        prompt:
          "Forklar med dine egne ord, hvordan man kan finde en bølges fart, og hvorfor det virker. Tænk på, " +
          "hvor langt bølgen flytter sig i løbet af én periode.",
        minWords: 60,
      },
    ],
    note: {
      title: "Tip",
      body:
        "Den blå markør svinger op og ned ét fast sted. Tæl, hvor mange svingninger den laver på et " +
        "sekund, og se, hvor langt en bølgetop når at flytte sig imens.",
    },
    conceptMap: {
      title: "Bølgefart",
      nodes: [
        {
          id: "aflaese-boelgen",
          label: "Frekvens, bølgelængde og periode",
          doneWhen: "kan pege på bølgelængden på bølgen og forklare, hvad frekvensen tæller",
          questions: [
            {
              prompt: "Hvad er forskellen på amplitude og bølgelængde?",
              expectedAnswer: "amplituden er udsvinget op/ned; bølgelængden er afstanden mellem to toppe",
            },
          ],
        },
        {
          id: "periode-frekvens",
          label: "Periode og frekvens",
          dependsOn: ["aflaese-boelgen"],
          doneWhen: "kan finde sammenhængen mellem T og f ud fra sin egen tabel",
          questions: [
            {
              prompt: "Hvad sker der med perioden, når du fordobler frekvensen?",
              expectedAnswer: "den halveres — T = 1/f",
            },
          ],
        },
        {
          id: "boelgefart",
          label: "Hvor hurtigt bølgen løber",
          dependsOn: ["periode-frekvens"],
          doneWhen: "kan begrunde v = f·λ ud fra, at bølgen flytter sig én bølgelængde på én periode",
          questions: [
            {
              prompt: "Hvor langt flytter en bølgetop sig i løbet af én periode?",
              expectedAnswer: "én bølgelængde — så v = λ/T = f·λ",
            },
          ],
        },
      ],
    },
  },
  {
    id: "wave-interference",
    name: "Interferens — når to bølger mødes",
    summary: "Interferens-simulation + datatabel + graf — faseforskydning, forstærkning og svævninger.",
    language: "da",
    subject: "Fysik",
    title: "Interferens",
    artefactId: "wave-interference",
    teachingGoal:
      "Hjælp eleven med at undersøge, hvad der sker, når to bølger i samme medium lægges sammen. Bed " +
      "eleven først holde bølgelængderne ens og ændre faseforskydningen, og siden gøre bølgelængderne " +
      "lidt forskellige. Spørg, hvad eleven forventer, før de kigger, og lad dem selv beskrive " +
      "sammenhængen mellem faseforskydning og den største amplitude. Hvis eleven siger, at energien " +
      "forsvinder ved udslukning, så brug tid på det.",
    checklist: [
      "Hold bølgelængderne ens og mål den største amplitude ved mindst 5 faseforskydninger",
      "Find den faseforskydning, der giver den største og den mindste amplitude",
      "Gør bølgelængderne lidt forskellige og beskriv, hvad der sker",
      "Forklar, hvor energien er, når bølgerne udslukker hinanden",
    ],
    table: {
      title: "Målinger",
      columns: [
        { label: "Faseforskydning", unit: "°", kind: "number" },
        { label: "Største amplitude", unit: "m", kind: "number" },
      ],
      rows: 8,
    },
    chart: { title: "Største amplitude mod faseforskydning", chartKind: "scatter" },
    writing: [
      {
        title: "Forklaring",
        prompt:
          "Forklar med dine egne ord, hvad der sker, når de to bølger lægges sammen ved forskellige " +
          "faseforskydninger — og hvad der sker, når bølgelængderne er lidt forskellige.",
        minWords: 80,
      },
    ],
    note: {
      title: "Tip",
      body:
        "Den grønne kurve er summen af de to bølger. Skjul den og vis den igen, og sammenlign den med " +
        "de to bølger hver for sig — punkt for punkt.",
    },
    conceptMap: {
      title: "Interferens",
      nodes: [
        {
          id: "summen",
          label: "Læg to bølger sammen",
          doneWhen: "kan finde summens udsving i ét punkt ved at lægge de to bølgers udsving sammen",
          questions: [
            {
              prompt: "Den ene bølge har udsvinget 0,6 m og den anden −0,4 m i samme punkt. Hvad er summens udsving?",
              expectedAnswer: "0,2 m — udsvingene lægges sammen med fortegn",
            },
          ],
        },
        {
          id: "faseforskydning",
          label: "Faseforskydning",
          dependsOn: ["summen"],
          doneWhen: "kan forudsige, ved hvilke faseforskydninger bølgerne forstærker og udslukker hinanden, og begrunde det",
          questions: [
            {
              prompt: "Ved hvilken faseforskydning udslukker to ens bølger hinanden, og hvorfor?",
              expectedAnswer: "180° — top møder bund overalt, så summen er nul",
            },
          ],
        },
        {
          id: "svaevninger",
          label: "Lidt forskellige bølgelængder",
          dependsOn: ["faseforskydning"],
          doneWhen: "kan forklare svævninger som skiftevis forstærkning og udslukning, fordi faseforskellen ændrer sig",
          questions: [
            {
              prompt: "Hvorfor skifter summen mellem store og små udsving, når bølgelængderne er lidt forskellige?",
              expectedAnswer: "frekvenserne er forskellige, så faseforskellen vandrer — skiftevis i fase og i modfase",
            },
          ],
        },
        {
          id: "energien",
          label: "Hvor er energien?",
          dependsOn: ["faseforskydning"],
          doneWhen: "kan forklare, at energien ikke forsvinder ved udslukning men fordeles til steder med forstærkning",
          questions: [
            {
              prompt: "Forsvinder energien, når to bølger udslukker hinanden?",
              expectedAnswer: "nej — den omfordeles til de steder, hvor bølgerne forstærker hinanden",
            },
          ],
        },
      ],
    },
  },
  {
    // The missions and the diagnostic quiz live INSIDE this sim (recorded
    // exception — they reconfigure the scene), so this starter adds no table
    // or checklist of its own tasks; it frames the missions and asks for one
    // piece of writing the sim cannot hold.
    id: "sol-jord-maane",
    name: "Sol, Jord og Måne — missioner",
    summary: "3D-model af Sol, Jord og Måne — døgn, årstider, månefaser og formørkelser gennem fem missioner.",
    language: "da",
    subject: "Fysik",
    title: "Sol, Jord og Måne",
    artefactId: "sol-jord-maane",
    teachingGoal:
      "Eleven arbejder i en 3D-model af Sol, Jord og Måne med rigtige positioner. Målet er, at eleven selv " +
      "kan forklare døgn, årstider, månefaser og formørkelser ud fra, hvordan de tre legemer står og " +
      "bevæger sig. Start med de seks spørgsmål under 'Hvad tænker du nu?', og anbefal en første mission " +
      "ud fra svarene. Knyt samtalen til konkrete aflæsninger og visninger i simulationen. Skriv ikke " +
      "elevens svar på missionens spørgsmål.",
    checklist: [
      "Besvar de seks spørgsmål under 'Hvad tænker du nu?'",
      "Løs den mission, tutoren anbefaler",
      "Løs mindst én mission mere",
      "Skriv din forklaring på årstiderne",
    ],
    writing: [
      {
        title: "Årstiderne",
        prompt:
          "Hvorfor er det koldere om vinteren end om sommeren i Danmark? Brug mindst to aflæsninger fra " +
          "simulationen som argument, og forklar, hvorfor det er omvendt i Sydney.",
        minWords: 100,
      },
    ],
    note: {
      title: "Sådan kommer du i gang",
      body:
        "Åbn **Missioner** for at vælge en opgave. Missionen stiller simulationen op for dig og viser et " +
        "kort med spørgsmålet og et par trin.\n\n" +
        "Tallene står under **Målinger**. Du kan skifte udsigtspunkt, skala og tid, og **Spring til** " +
        "hopper direkte til fx en fuldmåne eller en solhverv.",
    },
    conceptMap: {
      title: "Sol, Jord og Måne",
      nodes: [
        {
          id: "doegn",
          label: "Døgn",
          doneWhen: "forklarer dag og nat med Jordens rotation, og at Solen (næsten) står stille",
          questions: [
            {
              prompt: "Hvad er det egentlig, der bevæger sig, når Solen 'går' hen over himlen?",
              expectedAnswer: "Jorden roterer én gang i døgnet; Solens bevægelse på himlen er tilsyneladende",
            },
          ],
        },
        {
          id: "aarstider",
          label: "Årstider",
          dependsOn: ["doegn"],
          doneWhen: "forklarer årstiderne med aksehældningen (solhøjde og daglængde), ikke med afstanden til Solen",
          questions: [
            {
              prompt: "Hvorfor er det koldere om vinteren end om sommeren?",
              expectedAnswer:
                "aksehældningen giver lavere solhøjde og kortere dage om vinteren; afstanden varierer kun ca. 3 % og er mindst i januar",
            },
          ],
        },
        {
          id: "maanefaser",
          label: "Månefaser",
          doneWhen: "forklarer faserne med, at Solen altid lyser halvdelen af Månen op, og at vi ser mere eller mindre af den",
          questions: [
            {
              prompt: "Hvorfor skifter Månen form i løbet af en måned?",
              expectedAnswer:
                "Solen lyser altid halvdelen af Månen op; hvor meget af den oplyste halvdel vi ser, afhænger af Månens plads i banen",
            },
          ],
        },
        {
          id: "formoerkelser",
          label: "Formørkelser",
          dependsOn: ["maanefaser"],
          doneWhen: "forklarer, at Månens bane hælder ca. 5°, så en formørkelse kræver nymåne eller fuldmåne nær knudelinjen",
          questions: [
            {
              prompt: "Hvorfor er der ikke solformørkelse ved hver nymåne?",
              expectedAnswer: "Månens bane hælder ca. 5°, så Månen passerer som regel over eller under Solen",
            },
          ],
        },
        {
          id: "skala",
          label: "Model og virkelighed",
          dependsOn: ["aarstider", "formoerkelser"],
          doneWhen: "kan beskrive, hvad den overdrevne skala forvrænger, og hvorfor en model forvrænger noget for at vise noget andet",
          questions: [
            {
              prompt: "Hvor langt væk er Månen, målt i jorddiametre?",
              expectedAnswer: "ca. 30 jorddiametre",
            },
          ],
        },
      ],
    },
  },
  {
    // The first MATHS starter. The sim withholds dy/dx and the word
    // "tangent" by design, and its tutorBlock forbids suggesting a point
    // either side of the one of interest and handing over the grid — so
    // neither the checklist, the note nor a node label does either.
    id: "sekant-intro",
    name: "Hvor stejl er grafen i et punkt?",
    summary: "Sekantbænk — aflæs punkter på en parabel og undersøg hældningen i ét punkt.",
    language: "da",
    subject: "Matematik",
    title: "Hældning i et punkt",
    artefactId: "sekant-intro",
    teachingGoal:
      "Eleven undersøger, hvor stejl en parabel er i ét bestemt punkt, med udgangspunkt i h(x) = ⅓x² + 2x + 1 " +
      "ved x = 1. Eleven aflæser punkter, indsætter sekanter og linjer og regner selv hældningerne ud. " +
      "Pointen er at opdage, at en ret linjes hældning kræver to punkter, mens et punkt på en kurve kun " +
      "giver ét. Spørg, hvad eleven har målt, og hvad de gjorde med det. Nævn ikke ordet tangent, før " +
      "eleven selv har beskrevet idéen, og oplys aldrig en hældning.",
    checklist: [
      "Aflæs nogle punkter på f og g",
      "Indsæt en sekant, og find dens hældning",
      "Undersøg: hvilken af f og g er stejlest?",
      "Skift til h, og undersøg hvor stejl h er i x = 1",
      "Forklar, hvordan du fandt frem til dit bud",
    ],
    table: {
      title: "Sekanter",
      columns: [
        { label: "x₁", kind: "number" },
        { label: "x₂", kind: "number" },
        { label: "Δx", kind: "number" },
        { label: "Δy", kind: "number" },
        { label: "Hældning", kind: "number" },
      ],
      rows: 6,
    },
    writing: [
      {
        title: "Dit bud",
        prompt:
          "Hvor stejl er h i x = 1? Skriv dit bud, og forklar, hvordan du fandt frem til det, og hvorfor du " +
          "stoler på det. Hvad var svært ved at give et præcist svar?",
        minWords: 60,
      },
    ],
    note: {
      title: "Sådan bruger du bænken",
      body:
        "**Klik** på en kurve for at aflæse et punkt. **Træk** i grafen for at se mere af den.\n\n" +
        "Værktøjerne til at tegne linjer ligger bag knappen med de **tre streger**.",
    },
    conceptMap: {
      title: "Hældning i et punkt",
      nodes: [
        {
          id: "aflaese-punkt",
          label: "Aflæse et punkt på grafen",
          doneWhen: "ser, at y-værdien i et punkt på grafen er funktionsværdien i x, og indtaster den selv",
          questions: [
            {
              prompt: "Bænken skriver g(1,25) = −1,875. Hvilke tal skal i felterne x₁ og y₁?",
              expectedAnswer: "x₁ = 1,25 og y₁ = −1,875 — y er funktionens værdi i x",
            },
          ],
        },
        {
          id: "to-punkter",
          label: "Hældning mellem to punkter",
          dependsOn: ["aflaese-punkt"],
          doneWhen: "beregner Δy/Δx for en sekant selv og kan sige, hvad tallet betyder",
          questions: [
            {
              prompt: "Bænken viser Δx og Δy for din sekant. Hvordan får du hældningen ud af dem?",
              expectedAnswer: "hældningen er Δy/Δx — hvor meget y ændrer sig pr. enhed x",
            },
          ],
        },
        {
          id: "ingen-faelles-haeldning",
          label: "Sammenligne f og g",
          dependsOn: ["to-punkter"],
          doneWhen: "kan forklare med egne målinger, at 'hvilken kurve er stejlest?' ikke har et svar uden et punkt",
          questions: [
            {
              prompt: "Er f eller g stejlest?",
              expectedAnswer: "det afhænger af hvor — fx er g flad i x = 1, mens f stiger; i x = 2 er de lige stejle",
            },
          ],
        },
        {
          id: "haeldning-i-et-punkt",
          label: "Hældning i ét punkt",
          dependsOn: ["ingen-faelles-haeldning"],
          doneWhen:
            "lader det andet punkt nærme sig x = 1 fra begge sider og argumenterer for et bud mellem de to rækker af sekanthældninger",
          questions: [
            {
              prompt: "Hvad sker der med sekantens hældning, når det andet punkt kommer tættere og tættere på x = 1?",
              expectedAnswer:
                "hældningerne nærmer sig et bestemt tal (8/3 ≈ 2,67) — ovenfra fra højre og nedefra fra venstre",
            },
          ],
        },
      ],
    },
  },
  {
    // MOBILE-1 (2026-08-13) — the first deliberately MOBILE-FIRST, OUTDOOR
    // template. Every other starter assumes a desk: a sim iframe, a wide table,
    // a chart. This one assumes a phone shared by three students standing on
    // asphalt, and is built only from elements that survive a 390px viewport:
    // checklist (the field procedure), a two-column table, one scatter chart,
    // a one-input-pair calculator, and the SOLUTION element — a photo of the
    // chalk construction, which is the actual measurement instrument here.
    //
    // Deliberately NO `artefactId`. The three shipped sims are the desktop-bound
    // half of the palette (LED-Planck's fixed-coordinate bench is unusable below
    // ~720px); the schoolyard IS the simulation. This is also the template that
    // exercises the camera path end to end, which is why it lands alongside the
    // ImageComposer fix.
    //
    // Lineage: Jesper's embodied-learning lesson in
    // docs/design/forks/playground-tutor/v0.1.0/scope.md — groups of three on one
    // phone, chalk diagrams on asphalt, sight lines meeting at an intersection.
    //
    // THE DATA IS TYCHO'S OWN (2026-08-13). Five pairs of Brahe's naked-eye
    // observations from 1585/1587, the set Kepler worked from — dates are
    // JULIAN, as recorded in Denmark, which kept that calendar until 1700.
    //
    // Verified, not trusted, before shipping (see the test beside this file,
    // which re-derives the orbit from these very numbers and fails if an angle
    // is ever edited):
    //   * every gap is 686–687 days — one Mars sidereal period, so Mars is at
    //     the same point in its orbit both times, which is the entire trick;
    //   * Earth's longitude advances 316–317° across each gap, exactly what
    //     687 days of Earth's own motion gives (687 x 0,9856 = 677 = 317 mod 360);
    //   * triangulating them yields Sun–Mars distances of 1,380–1,688 AU
    //     against Mars' true 1,381–1,666. Naked-eye data, to about 1–2%.
    // The sight lines cross at 47–63°, so the intersections are robust rather
    // than the near-parallel case where a degree of chalk error explodes.
    //
    // Known sampling limitation, deliberately left in and handled in the tutor
    // goal: the five points sit at roughly 45°, 149°, 158°, 185° and 330°, so
    // three cluster near aphelion. That is enough to demolish "the orbit is a
    // circle" (1,38 against 1,69 is unmissable) but not enough to fit an
    // ellipse properly. Kepler had many more pairs.
    //
    // Physics/Danish review by AR/JB still applies, as with every starter.
    id: "kepler-chalk-orbit",
    name: "Mars' bane med kridt i skolegården",
    summary: "Udendørs, mobil-først: konstruér Mars' bane med kridt og snor, fotografér den, aflæs afstanden.",
    language: "da",
    title: "Mars' bane — kridt i skolegården",
    teachingGoal:
      "Eleverne står udenfor med en telefon, kridt og en snor og konstruerer Mars' bane med Keplers " +
      "metode ud fra Tycho Brahes egne observationer fra 1585 og 1587. Solen i centrum, Jordens bane " +
      "som en cirkel, og to sigtelinjer fra to jordpositioner, der er 687 dage fra hinanden (ét Mars-år, " +
      "så Mars står samme sted i sin bane begge gange). Skæringspunktet er ét punkt på Mars' bane. " +
      "Din rolle: hjælp dem med METODEN og med at tolke deres egne målinger — konstruér ikke banen for " +
      "dem og afslør ikke facit. Når de har 4–5 punkter, så spørg, om afstanden Sol–Mars er den samme " +
      "hele vejen rundt; det er pointen, at den ikke er. " +
      "Til din egen kontrol (sig det ikke direkte): Mars' middelafstand er ca. 1,52 AU, og afstanden " +
      "varierer mellem ca. 1,38 AU og ca. 1,67 AU. Med Tychos tal bør målepar 2 give ca. 1,38 AU " +
      "(nær perihel) og målepar 1 og 5 ca. 1,68 AU (nær aphel) — netop den forskel, der afliver cirklen. " +
      "Ligger et punkt langt uden for 1,3–1,7, så er den HYPPIGSTE fejl denne: sigtelinjen fra Jorden " +
      "er afsat med vinkelmålerens 0° pegende mod Solen i stedet for parallelt med gruppens egen " +
      "0°-streg. Alle vinkler i skemaet måles fra den SAMME faste retning, uanset hvor på cirklen man " +
      "står — flytter man vinkelmåleren ud til Jorden, skal 0° stadig vende samme vej. Næst-hyppigste: " +
      "de to sigtelinjer byttet om, eller vinkler afsat med uret. Spørg til det i stedet for at rette " +
      "det — bed dem tjekke ét målepar, de allerede har, mod de andre. " +
      "Bemærk, at tre af de fem punkter ligger tæt på hinanden nær aphel: eleverne kan altså vise, at " +
      "banen IKKE er en cirkel, men de har for få punkter til at bestemme ellipsens form. Hvis de " +
      "spørger, så sig det ligeud — Kepler brugte mange flere målepar end fem. " +
      "Eleverne arbejder på én delt telefon: hold svarene korte, og bed om et foto, når du er i tvivl " +
      "om, hvad de har tegnet.",
    checklist: [
      "Tegn Solen og Jordens bane med kridt og snor — notér radius i meter",
      "Tegn 0°-stregen ud fra Solen, og afsæt de to jordpositioner for målepar 1",
      "Stræk snoren i de to sigteretninger (0° parallelt med jeres 0°-streg) og markér krydset",
      "Mål afstanden Sol–Mars med snoren og omregn til AU",
      "Gentag for alle fem målepar i skemaet",
      "Tag et billede af hele konstruktionen og send det til tutoren",
    ],
    table: {
      title: "Punkter på Mars' bane",
      columns: [
        { label: "Mars' retning fra Solen", unit: "°", kind: "number" },
        { label: "Afstand Sol–Mars", unit: "AU", kind: "number" },
      ],
      rows: 6,
    },
    // r mod θ: a circular orbit is a flat line, an ellipse is a wave. The whole
    // conclusion is visible in the shape of this one plot.
    chart: { title: "Afstand mod retning", chartKind: "scatter" },
    calculator: {
      title: "Fra kridt-meter til AU",
      // The conversion they repeat at every single point: the chalk circle they
      // drew for Earth's orbit IS 1 AU, so any length divided by that radius is
      // already in astronomical units. No scale factor to remember, no ruler.
      formula: "r / R",
      inputs: [
        { id: "r", label: "Sol–Mars målt med snor", unit: "m" },
        { id: "R", label: "Jordbanens radius (kridt)", unit: "m" },
      ],
    },
    solution: {
      prompt:
        "Tag et billede af jeres kridttegning — hele cirklen, sigtelinjerne og de punkter, I har " +
        "markeret. Skriv kort, hvilket målepar billedet viser.",
    },
    writing: [
      {
        title: "Konklusion",
        prompt:
          "Er afstanden fra Solen til Mars den samme hele vejen rundt? Hvad siger jeres punkter om " +
          "banens form? Skriv jeres største og mindste målte afstand, og nævn mindst én grund til, at " +
          "målingerne kan være upræcise, når man tegner med kridt udendørs.",
        minWords: 80,
      },
    ],
    note: {
      title: "Sådan gør I",
      body:
        "**Idéen:** Mars bruger 687 dage om ét omløb. To observationer med præcis 687 dages mellemrum " +
        "viser derfor Mars *samme sted* i sin bane — men set fra to forskellige steder på Jordens bane. " +
        "De to sigtelinjer skærer hinanden dér, hvor Mars er.\n\n" +
        "**I skal bruge:** kridt, et snorstykke på mindst 3 m, en stor vinkelmåler (print den " +
        "på A3 — telefonens kompas peger mod MAGNETISK nord og duer ikke her), og ca. **5 × 5 m " +
        "fri asfalt** per gruppe.\n\n" +
        "**Skala:** Tegn Jordens bane som en cirkel med kridt og snor. Den radius, I vælger, **er 1 AU**. " +
        "Vælg ca. 1,5 m — Mars ligger uden for cirklen, helt ude i ca. 1,7 gange radius, så hele " +
        "tegningen fylder omkring 5 m på tværs.\n\n" +
        "1. Sæt et kridtkryds i midten — det er Solen. Bind snoren og tegn cirklen.\n" +
        "2. Vælg en retning ud fra Solen som **0°** og tegn den streg helt ud. Alle vinkler i " +
        "skemaet måles fra den streg, **mod uret**. Læg vinkelmåleren med midten på Solen.\n" +
        "3. Afsæt de **to jordpositioner** for jeres målepar (kolonne *Jorden*): mål vinklen ud fra " +
        "Solen, og sæt krydset dér hvor stregen rammer cirklen.\n" +
        "4. Sigtelinjerne måles fra **Jorden**, ikke fra Solen: flyt vinkelmåleren ud til " +
        "jordpositionen, og læg 0°-retningen **parallel med jeres 0°-streg** (brug snoren til at " +
        "holde den parallel). Stræk så snoren i retningen fra kolonnen *Mars set fra Jorden*. " +
        "Hvor de to sigtelinjer krydser, står Mars.\n" +
        "5. Mål fra Solen ud til krydset og divider med jeres cirkelradius — det er afstanden i AU.\n" +
        "6. Mål også retningen fra Solen ud til krydset, og skriv begge tal i tabellen.\n\n" +
        "**Tychos observationer** (Brahes egne tal — de samme, Kepler regnede på). " +
        "Datoerne er efter den gamle julianske kalender, som man brugte i Danmark dengang:\n\n" +
        "| Målepar | Datoer | Jorden | Mars set fra Jorden |\n" +
        "|---|---|---|---|\n" +
        "| 1 | 17. feb 1585 / 5. jan 1587 | 159° og 115° | 135° og 182° |\n" +
        "| 2 | 19. sep 1585 / 6. aug 1587 | 6° og 323° | 284° og 347° |\n" +
        "| 3 | 7. dec 1585 / 25. okt 1587 | 86° og 42° | 3° og 50° |\n" +
        "| 4 | 28. mar 1585 / 12. feb 1587 | 197° og 154° | 168° og 219° |\n" +
        "| 5 | 10. mar 1585 / 26. jan 1587 | 180° og 136° | 132° og 185° |\n\n" +
        "**Tip:** Skriv målepar-nummeret ved hvert kryds med kridt, så I kan se på fotoet, hvad der er hvad. " +
        "Tjek altid, at der er ca. 687 dage mellem de to datoer — det er hele pointen.",
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
    // 1.1.73 (JB, 2026-08-11) — the writing surface, as its own starter so the
    // picker demos all THREE student-submission shapes: prose (here), drawn
    // physics ("Din løsning"), and an uploaded file ("Dokumentfeedback").
    id: "written-conclusion",
    name: "Skriftlig konklusion",
    summary: "Eleven skriver en tekst, henter den som fil — tutoren kommenterer undervejs.",
    language: "da",
    title: "Skriftlig konklusion",
    teachingGoal:
      "Hjælp eleven med at skrive en bedre fysikfaglig tekst. Du kan se, hvad eleven skriver, mens de " +
      "skriver. Kommentér på strukturen og fysikken: bruges fagbegreberne rigtigt, følger konklusionen " +
      "af data, er usikkerheder nævnt? **Skriv aldrig teksten for eleven** og omskriv den ikke — peg på, " +
      "hvad der mangler, og stil et spørgsmål, så eleven selv kan rette det. Ros først noget, der " +
      "fungerer. Vent med at kommentere, til eleven spørger.",
    checklist: [
      "Skriv et udkast",
      "Bed tutoren om feedback",
      "Ret det vigtigste og hent teksten som fil",
    ],
    writing: [
      {
        title: "Din tekst",
        prompt:
          "Skriv din tekst her. Du kan hente den som fil, når du er færdig — og du kan bede tutoren " +
          "om feedback undervejs.",
        minWords: 150,
      },
    ],
    note: {
      title: "Sådan skriver du en god konklusion",
      body:
        "1. **Hvad undersøgte I?** Én sætning.\n" +
        "2. **Hvad viser data?** Henvis til jeres målinger eller graf.\n" +
        "3. **Hvad betyder det fysisk?** Brug fagbegreberne.\n" +
        "4. **Usikkerhed:** Hvad kunne have påvirket resultatet?",
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
