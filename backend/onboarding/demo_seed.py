"""Seed a brand-new teacher's onboarding demo on first app load.

Creates a 'Demo class' with a join code and a curated set of example activities —
a "how this works" concept dialogue, all three sims (Boldkast / KineBot /
LED-Planck), two bench labs, and the solution / document feedback surfaces — so a
teacher signing in for the first time immediately sees what the platform does and
can explore, edit, or delete it.

Idempotent + safe by construction: no-ops if the teacher already owns ANY class,
so it runs at most once per teacher and never overwrites their work. After the
dev clean-slate wipe every teacher has zero classes, so the next sign-in reseeds
a fresh demo.
"""

from __future__ import annotations

import logging

from auth.access_tiers import DEFAULT_ACCESS_TIER, can_spend
from db.activities import create_activity
from db.classes import (
    add_activities,
    create_class,
    list_classes_for_owner,
    mint_group_codes_under_class,
)
from db.firestore import query_documents
from db.models.activity import Activity
from db.models.activity_config import (
    CalcInput,
    CalculatorElement,
    ChartElement,
    ChecklistItem,
    CheckQuestion,
    ConceptEdge,
    ConceptMapElement,
    ConceptNode,
    DocumentElement,
    NoteElement,
    SolutionElement,
    TableColumn,
    TableElement,
    WritingElement,
)
from db.models.class_ import Class

log = logging.getLogger(__name__)

DEMO_CLASS_NAME = "Demo class"
# Dev concept-dialogue skill id; used only if the slug lookup finds nothing.
_CONCEPT_SKILL_FALLBACK = "f45dc300-4b90-4162-8f28-07fb42989378"


def _concept_skill_id() -> str:
    """Resolve the concept-dialogue skill id by slug (portable across envs),
    falling back to the known dev id."""
    docs = query_documents("skills", filters=[("slug", "==", "concept-dialogue")], limit=1)
    if docs:
        return docs[0].get("__id") or docs[0].get("skillId") or _CONCEPT_SKILL_FALLBACK
    return _CONCEPT_SKILL_FALLBACK


def _demo_activities(owner_uid: str, concept_skill: str) -> list[Activity]:
    """The demo class's example activities — a curated tour of the platform.

    All run the concept-dialogue skill; the sim activities attach a vetted
    artefact via ``artefactId`` (resolved to the sim's tutor at student-
    instantiation time; sets ``workbench_type=app``). Between them they cover all
    three sims (Boldkast / KineBot / LED-Planck), the element palette (checklist /
    table / chart / calculator / note / writing / solution / document) and a living
    concept map. Kept deliberately curated (not every picker template) so a walk-in demo
    stays focused; the full starter set lives in the teacher's template picker
    (``frontend/src/lib/activityTemplates.ts``)."""
    welcome = Activity(
        activityId="",
        ownerUid=owner_uid,
        skillId=concept_skill,
        title="Velkommen — sådan virker AIPLA",
        teachingGoal=(
            "Introducér eleven til AIPLA: en fysik-tutor der stiller spørgsmål i stedet for "
            "at give svaret. Bekræft at eleven kan skrive til tutoren og forstår arbejdsgangen."
        ),
        note=[
            NoteElement(
                id="how-it-works",
                title="Sådan virker det",
                body=(
                    "Dette er en **demo-aktivitet**. Tutoren hjælper eleven ved at stille "
                    "spørgsmål — den giver aldrig det fulde svar med det samme.\n\n"
                    "- Skriv et spørgsmål i chatten for at komme i gang.\n"
                    "- Som lærer kan du redigere denne aktivitet, eller slette demo-klassen "
                    "når du er klar til at bygge dine egne."
                ),
            )
        ],
        checklist=[
            ChecklistItem(id="say-hi", label="Sig hej til tutoren"),
            ChecklistItem(id="ask", label="Stil et spørgsmål om fysik"),
        ],
    )
    boldkast = Activity(
        activityId="",
        ownerUid=owner_uid,
        skillId=concept_skill,
        artefactId="boldkast",
        title="Kastebevægelse (Boldkast)",
        teachingGoal=(
            "Eleven undersøger skråt kast med Boldkast-simulationen: hvordan udgangsvinkel "
            "og starthastighed påvirker rækkevidde, flyvetid og maksimal højde. Tutoren ser "
            "elevens valgte indstillinger."
        ),
        note=[
            NoteElement(
                id="opgave",
                title="Opgave",
                body=(
                    "Brug simulationen til at undersøge et skråt kast.\n\n"
                    "Indstil starthastighed (v₀) og vinkel (θ), tryk **Afspil**, og spørg "
                    "tutoren hvad der sker, når du ændrer vinklen."
                ),
            )
        ],
        checklist=[
            ChecklistItem(id="a", label="a) Hvor lang tid er bolden i luften?"),
            ChecklistItem(id="b", label="b) Hvor langt rækker den (vandret distance)?"),
            ChecklistItem(id="c", label="c) Hvad er den maksimale højde?"),
            ChecklistItem(id="d", label="d) Hvilken vinkel giver den største rækkevidde?"),
        ],
        # Living concept map (CONCEPT-1 M4): the demo's prerequisite graph +
        # chat-native check questions — the tutor runs checkpoints in the
        # conversation and the student's map lights up.
        conceptMap=[
            ConceptMapElement(
                id="concept-map-1",
                title="Kastebevægelse",
                nodes=[
                    ConceptNode(
                        id="vektorer",
                        label="Vektorer",
                        check_questions=[
                            CheckQuestion(
                                id="q-1",
                                prompt="Hvordan finder du den vandrette og lodrette del af starthastigheden ved 30°?",
                                expected_answer="vx = v0·cos(30°), vy = v0·sin(30°) — dekomponering med cos og sin",
                            )
                        ],
                    ),
                    ConceptNode(
                        id="trigonometri",
                        label="Trigonometri",
                        check_questions=[
                            CheckQuestion(
                                id="q-1",
                                prompt="Hvorfor bruger vi cosinus til den vandrette komposant og sinus til den lodrette?",
                                expected_answer=(
                                    "cos giver den hosliggende (vandrette) katete, sin den modstående (lodrette) "
                                    "i den retvinklede trekant hastigheden danner"
                                ),
                            )
                        ],
                    ),
                    ConceptNode(
                        id="projektilbevaegelse",
                        label="Projektilbevægelse",
                        check_questions=[
                            CheckQuestion(
                                id="q-1",
                                prompt="Hvorfor er banen en parabel — hvad sker der i x- og y-retningen hver for sig?",
                                expected_answer=(
                                    "x: konstant hastighed (ingen kraft); y: konstant acceleration nedad (tyngden) "
                                    "— tilsammen en parabel"
                                ),
                            ),
                            CheckQuestion(
                                id="q-2",
                                prompt="Hvilken vinkel giver størst rækkevidde uden luftmodstand, og hvorfor?",
                                expected_answer="45° — bedste balance mellem flyvetid (sin) og vandret fart (cos)",
                            ),
                        ],
                    ),
                ],
                edges=[
                    ConceptEdge.model_validate({"from": "vektorer", "to": "projektilbevaegelse"}),
                    ConceptEdge.model_validate({"from": "trigonometri", "to": "projektilbevaegelse"}),
                ],
            )
        ],
    )
    kinebot = Activity(
        activityId="",
        ownerUid=owner_uid,
        skillId=concept_skill,
        artefactId="kinebot",
        title="Bevægelsesgrafer (KineBot)",
        teachingGoal=(
            "Eleven undersøger sammenhængen mellem sted, fart og acceleration med "
            "KineBot-simulationen. Stil spørgsmål til, hvad de tre grafer viser — "
            "konkludér ikke selv, men lad eleven aflæse graferne."
        ),
        note=[
            NoteElement(
                id="grafer",
                title="Bevægelsesgrafer",
                body=(
                    "**Sted (s-t):** hældningen er farten.\n\n"
                    "**Fart (v-t):** hældningen er accelerationen; arealet er strækningen.\n\n"
                    "**Acceleration (a-t):** arealet er ændringen i fart."
                ),
            )
        ],
        checklist=[
            ChecklistItem(id="konstant-fart", label="Undersøg en bevægelse med konstant fart"),
            ChecklistItem(id="konstant-acc", label="Undersøg en bevægelse med konstant acceleration"),
            ChecklistItem(id="sammenhaeng", label="Forklar sammenhængen mellem de tre grafer"),
        ],
        conceptMap=[
            ConceptMapElement(
                id="concept-map-kinebot",
                title="Bevægelsesgrafer",
                nodes=[
                    ConceptNode(
                        id="fart",
                        label="Fart",
                        check_questions=[
                            CheckQuestion(
                                id="q-1",
                                prompt="Hvad fortæller hældningen på en sted-tid-graf?",
                                expected_answer="farten (hastigheden) — jo stejlere kurve, jo større fart",
                            )
                        ],
                    ),
                    ConceptNode(
                        id="acceleration",
                        label="Acceleration",
                        check_questions=[
                            CheckQuestion(
                                id="q-1",
                                prompt="Hvad fortæller hældningen på en fart-tid-graf?",
                                expected_answer="accelerationen — ændringen i fart pr. tid",
                            )
                        ],
                    ),
                    ConceptNode(
                        id="grafer",
                        label="Bevægelsesgrafer",
                        check_questions=[
                            CheckQuestion(
                                id="q-1",
                                prompt="Hvordan ser fart-tid-grafen ud, når accelerationen er konstant?",
                                expected_answer="en ret linje med konstant hældning",
                            )
                        ],
                    ),
                ],
                edges=[
                    ConceptEdge.model_validate({"from": "fart", "to": "grafer"}),
                    ConceptEdge.model_validate({"from": "acceleration", "to": "grafer"}),
                ],
            )
        ],
    )
    planck = Activity(
        activityId="",
        ownerUid=owner_uid,
        skillId=concept_skill,
        artefactId="led-planck",
        title="Bestem Plancks konstant (LED)",
        teachingGoal=(
            "Eleven bestemmer Plancks konstant i det virtuelle LED-forsøg: mål tændspændingen "
            "for forskellige bølgelængder og notér den i tabellen. Afslør ikke formlen, men led "
            "eleven til selv at finde, hvordan h kan beregnes ud fra sammenhængen."
        ),
        note=[
            NoteElement(
                id="sammenhaeng",
                title="Sammenhæng",
                body=(
                    "**Fotonenergi:** E = h · c / λ = e · U\n\n"
                    "Deraf kan Plancks konstant h findes ud fra tændspændingen U og bølgelængden λ."
                ),
            )
        ],
        checklist=[
            ChecklistItem(id="maal", label="Mål tændspændingen for mindst 4 bølgelængder"),
            ChecklistItem(id="noter", label="Notér bølgelængde og tændspænding i tabellen"),
            ChecklistItem(id="beregn", label="Undersøg sammenhængen og beregn Plancks konstant"),
        ],
        table=[
            TableElement(
                id="maalinger",
                title="Målinger",
                rows=5,
                columns=[
                    TableColumn(id="lambda", label="Bølgelængde", unit="nm", kind="number"),
                    TableColumn(id="u", label="Tændspænding", unit="V", kind="number"),
                ],
            )
        ],
        chart=[ChartElement(id="graf", title="Tændspænding mod bølgelængde", chart_kind="scatter")],
    )
    hooke = Activity(
        activityId="",
        ownerUid=owner_uid,
        skillId=concept_skill,
        title="Hookes lov — fjederkraft",
        teachingGoal=(
            "Eleven undersøger Hookes lov på bænken: hæng lodder på en fjeder, mål forlængelsen, "
            "og notér kraft og forlængelse i tabellen. Stil spørgsmål til, om grafen er en ret "
            "linje, og hvad hældningen (fjederkonstanten k) betyder — konkludér ikke selv."
        ),
        note=[
            NoteElement(
                id="hooke",
                title="Hookes lov",
                body=(
                    "**Hookes lov:** F = k · x\n\nKraften er proportional med forlængelsen. "
                    "Hældningen på grafen er fjederkonstanten k."
                ),
            )
        ],
        checklist=[
            ChecklistItem(id="opstil", label="Opstil fjederen og vælg et referencepunkt"),
            ChecklistItem(id="maal", label="Mål forlængelsen for mindst 5 forskellige kræfter"),
            ChecklistItem(id="aflaes", label="Aflæs fjederkonstanten fra grafen"),
            ChecklistItem(id="konkluder", label="Skriv jeres konklusion og hent den som fil"),
        ],
        # 1.1.73 — the lab arc used to stop at the graph. The conclusion is where
        # the physics happens, and it is the one element the tutor can comment on
        # while reading BOTH the table the student filled and the text about it.
        writing=[
            WritingElement(
                id="konklusion",
                title="Konklusion",
                prompt=(
                    "Skriv jeres konklusion: Er kraften proportional med forlængelsen? Hvad viser "
                    "hældningen, og hvad er fjederkonstanten k for jeres fjeder? Nævn mindst én "
                    "kilde til usikkerhed."
                ),
                min_words=100,
            )
        ],
        table=[
            TableElement(
                id="maalinger",
                title="Målinger",
                rows=6,
                columns=[
                    TableColumn(id="kraft", label="Kraft", unit="N", kind="number"),
                    TableColumn(id="forlaengelse", label="Forlængelse", unit="m", kind="number"),
                ],
            )
        ],
        chart=[ChartElement(id="graf", title="Kraft mod forlængelse", chart_kind="scatter")],
    )
    pendul = Activity(
        activityId="",
        ownerUid=owner_uid,
        skillId=concept_skill,
        title="Pendulets svingningstid",
        teachingGoal=(
            "Eleven måler pendulets svingningstid for forskellige længder og bruger beregneren til "
            "at finde tyngdeaccelerationen g. Stil spørgsmål til, hvordan svingningstiden afhænger "
            "af længden — konkludér ikke selv."
        ),
        note=[
            NoteElement(
                id="formel",
                title="Formel",
                body=(
                    "**Pendulets svingningstid:** T = 2π · √(L / g)\n\n"
                    "Deraf: **g = 4π² · L / T²** — brug beregneren til at finde g ud fra dine målinger."
                ),
            )
        ],
        checklist=[
            ChecklistItem(id="maal", label="Mål svingningstiden for mindst 5 forskellige længder"),
            ChecklistItem(id="noter", label="Notér længde og svingningstid i tabellen"),
            ChecklistItem(id="beregn", label="Beregn g og sammenlign med 9,82 m/s²"),
        ],
        table=[
            TableElement(
                id="maalinger",
                title="Målinger",
                rows=6,
                columns=[
                    TableColumn(id="laengde", label="Længde", unit="m", kind="number"),
                    TableColumn(id="tid", label="Svingningstid", unit="s", kind="number"),
                ],
            )
        ],
        chart=[ChartElement(id="graf", title="Svingningstid mod længde", chart_kind="scatter")],
        calculator=[
            CalculatorElement(
                id="g",
                title="Tyngdeacceleration",
                formula="4 * 3.14159 * 3.14159 * L / (T * T)",
                inputs=[
                    CalcInput(id="L", label="Længde", unit="m"),
                    CalcInput(id="T", label="Svingningstid", unit="s"),
                ],
            )
        ],
    )
    solution = Activity(
        activityId="",
        ownerUid=owner_uid,
        skillId=concept_skill,
        title="Din løsning",
        teachingGoal=(
            "Eleven fotograferer sin håndskrevne løsning på en fysikopgave. Giv aldrig det fulde "
            "svar — peg på et skridt, en værdi eller en formel der er forkert, og stil et spørgsmål, "
            "så eleven selv kan rette den. Tjek enheder, fortegn og om resultatet er realistisk."
        ),
        note=[
            NoteElement(
                id="tip",
                title="Tip",
                body=(
                    "Skriv din løsning på papir med alle udregninger, og tag et tydeligt billede.\n\n"
                    "Tutoren giver feedback på din fremgangsmåde — ikke bare facit."
                ),
            )
        ],
        checklist=[
            ChecklistItem(id="skriv", label="Skriv din løsning med udregninger"),
            ChecklistItem(id="forklar", label="Forklar dine skridt"),
            ChecklistItem(id="tjek", label="Tjek enheder og fortegn"),
        ],
        solution=[
            SolutionElement(
                id="loesning",
                prompt="Tag et billede af din håndskrevne løsning — vis dine udregninger og forklar dine skridt.",
            )
        ],
    )
    document = Activity(
        activityId="",
        ownerUid=owner_uid,
        skillId=concept_skill,
        title="Dokumentfeedback",
        teachingGoal=(
            "Eleven uploader sit eget arbejde (fx en rapport eller et opgavesæt), og tutoren giver "
            "feedback på den aktive fil. Giv aldrig det fulde svar — peg på, hvor noget er forkert "
            "eller mangler, og stil et spørgsmål, så eleven selv kan rette det."
        ),
        checklist=[
            ChecklistItem(id="upload", label="Upload dit arbejde"),
            ChecklistItem(id="laes", label="Læs tutorens feedback"),
            ChecklistItem(id="ret", label="Ret det vigtigste og upload igen"),
        ],
        document=[
            DocumentElement(
                id="fil",
                prompt="Upload et billede eller en fil af dit arbejde, så giver tutoren feedback.",
            )
        ],
    )
    find_error = Activity(
        activityId="",
        ownerUid=owner_uid,
        skillId=concept_skill,
        title="Find fejlen i måledata",
        teachingGoal=(
            "Eleven har fået et datasæt fra en tidligere gruppe (vist i noten) for en vogn, der kører "
            "med konstant fart (ca. 0,20 m/s, så position = 0,20 · tid). ÉN måling er forkert: ved tiden "
            "t = 3,0 s står positionen til 0,90 m, men den burde være ca. 0,60 m. AFSLØR IKKE hvilken "
            "måling der er forkert. Bed eleven gentage forsøget selv, indtaste sine egne målinger i "
            "tabellen og sammenligne med det udleverede datasæt. Stil spørgsmål til, hvilket punkt der "
            "afviger, og hvad årsagen kunne være — lad eleven selv opdage og begrunde fejlen."
        ),
        note=[
            NoteElement(
                id="datasaet",
                title="Udleveret datasæt",
                body=(
                    "En tidligere gruppe lod en vogn køre med konstant fart og målte positionen til "
                    "forskellige tider:\n\n"
                    "| Tid (s) | Position (m) |\n"
                    "|---|---|\n"
                    "| 1,0 | 0,20 |\n"
                    "| 2,0 | 0,40 |\n"
                    "| 3,0 | 0,90 |\n"
                    "| 4,0 | 0,80 |\n"
                    "| 5,0 | 1,00 |\n\n"
                    "Én af målingerne ser forkert ud. Gentag forsøget selv, og find ud af hvilken."
                ),
            )
        ],
        checklist=[
            ChecklistItem(id="gentag", label="Gentag forsøget og indtast dine egne målinger i tabellen"),
            ChecklistItem(id="sammenlign", label="Sammenlign dine data med det udleverede datasæt"),
            ChecklistItem(id="find", label="Find den måling der afviger, og forklar hvorfor"),
        ],
        table=[
            TableElement(
                id="maalinger",
                title="Dine målinger",
                rows=5,
                columns=[
                    TableColumn(id="tid", label="Tid", unit="s", kind="number"),
                    TableColumn(id="position", label="Position", unit="m", kind="number"),
                ],
            )
        ],
        chart=[ChartElement(id="graf", title="Position mod tid", chart_kind="scatter")],
    )
    return [welcome, boldkast, kinebot, planck, hooke, pendul, solution, document, find_error]


def seed_demo_for_teacher(owner_uid: str, *, access_tier: str = DEFAULT_ACCESS_TIER) -> dict | None:
    """Idempotently seed the teacher's onboarding demo.

    Returns a summary dict, or ``None`` when nothing was seeded (the teacher
    already owns at least one class — so this never runs over existing work).

    ``access_tier`` (ACCESS-1 M1) decides ONE thing: whether a student join code
    is minted. Everything else — the activities, the Demo class — is seeded
    identically for a visitor, because exploring them is the point of letting an
    uninvited person sign in at all.

    The join code is the exception because it is the fan-out vector. Anonymous
    group students carry no identity (ADR-001), so a code handed to an uninvited
    account is an unbounded number of unidentified sessions against our Vertex
    project, from one signup and one shared link. A visitor's Demo class simply
    has no code; the class page says so and links to the access request.
    """
    if list_classes_for_owner(owner_uid):
        return None

    concept_skill = _concept_skill_id()
    activity_ids = [create_activity(a).activity_id for a in _demo_activities(owner_uid, concept_skill)]

    demo_class = Class.create_for_teacher(owner_uid=owner_uid, name=DEMO_CLASS_NAME)
    create_class(demo_class)
    add_activities(demo_class.class_id, activity_ids)

    codes = mint_group_codes_under_class(demo_class.class_id, count=1) if can_spend(access_tier) else []

    log.info(
        "demo_seed: seeded teacher=%s tier=%s class=%s activities=%d code=%s",
        owner_uid,
        access_tier,
        demo_class.class_id,
        len(activity_ids),
        codes[0] if codes else "-(visitor: no join code)",
    )
    return {
        "classId": demo_class.class_id,
        "className": DEMO_CLASS_NAME,
        "activityIds": activity_ids,
        "joinCode": codes[0] if codes else None,
    }
