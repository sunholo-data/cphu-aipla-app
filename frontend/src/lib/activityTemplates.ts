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
      "Ligger et punkt langt uden for 1,3–1,7, er det næsten altid en vinkel afsat fra den forkerte " +
      "nulretning, eller de to sigtelinjer byttet om; spørg til det i stedet for at rette det. " +
      "Bemærk, at tre af de fem punkter ligger tæt på hinanden nær aphel: eleverne kan altså vise, at " +
      "banen IKKE er en cirkel, men de har for få punkter til at bestemme ellipsens form. Hvis de " +
      "spørger, så sig det ligeud — Kepler brugte mange flere målepar end fem. " +
      "Eleverne arbejder på én delt telefon: hold svarene korte, og bed om et foto, når du er i tvivl " +
      "om, hvad de har tegnet.",
    checklist: [
      "Tegn Solen og Jordens bane med kridt og snor — notér radius i meter",
      "Markér 0° på cirklen, og afsæt de to jordpositioner for målepar 1",
      "Stræk snoren i de to sigteretninger og markér skæringspunktet",
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
        "**Skala:** Tegn Jordens bane som en cirkel med kridt og snor. Den radius, I vælger, **er 1 AU**. " +
        "Vælg mindst 1,5 m — så fylder hele tegningen ca. 5 m, for Mars ligger uden for cirklen.\n\n" +
        "1. Sæt et kridtkryds i midten — det er Solen. Bind snoren og tegn cirklen.\n" +
        "2. Markér 0° på cirklen. Alle vinkler i skemaet måles herfra, mod uret.\n" +
        "3. Afsæt de **to jordpositioner** for jeres målepar (kolonne *Jorden*).\n" +
        "4. Stræk snoren fra hver jordposition i retningen fra kolonnen *Mars set fra Jorden*. " +
        "Hvor de to linjer krydser, står Mars.\n" +
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
