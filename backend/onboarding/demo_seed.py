"""Seed a brand-new teacher's onboarding demo on first app load.

Creates a 'Demo class' with a join code and two example activities — a concept
dialogue ("how this works") and a Boldkast sim — so a teacher signing in for the
first time immediately sees what the platform does and can explore, edit, or
delete it.

Idempotent + safe by construction: no-ops if the teacher already owns ANY class,
so it runs at most once per teacher and never overwrites their work. After the
dev clean-slate wipe every teacher has zero classes, so the next sign-in reseeds
a fresh demo.
"""

from __future__ import annotations

import logging

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
    ChecklistItem,
    CheckQuestion,
    ConceptEdge,
    ConceptMapElement,
    ConceptNode,
    NoteElement,
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
    """The two example activities. Both run the concept-dialogue skill; the
    second hosts the Boldkast sim artefact (the new artefact model)."""
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
    return [welcome, boldkast]


def seed_demo_for_teacher(owner_uid: str) -> dict | None:
    """Idempotently seed the teacher's onboarding demo.

    Returns a summary dict, or ``None`` when nothing was seeded (the teacher
    already owns at least one class — so this never runs over existing work).
    """
    if list_classes_for_owner(owner_uid):
        return None

    concept_skill = _concept_skill_id()
    activity_ids = [create_activity(a).activity_id for a in _demo_activities(owner_uid, concept_skill)]

    demo_class = Class.create_for_teacher(owner_uid=owner_uid, name=DEMO_CLASS_NAME)
    create_class(demo_class)
    add_activities(demo_class.class_id, activity_ids)
    codes = mint_group_codes_under_class(demo_class.class_id, count=1)

    log.info(
        "demo_seed: seeded teacher=%s class=%s activities=%d code=%s",
        owner_uid,
        demo_class.class_id,
        len(activity_ids),
        codes[0] if codes else "-",
    )
    return {
        "classId": demo_class.class_id,
        "className": DEMO_CLASS_NAME,
        "activityIds": activity_ids,
        "joinCode": codes[0] if codes else None,
    }
