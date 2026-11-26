"""1.1.164 M1 — only the newest "Ask for feedback" draft of a sheet stays whole.

Design: docs/design/aipla/v2.1.0-extension/tutor-tracks-what-is-settled.md
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from google.genai import types

from adk.superseded_drafts import TEMPLATES, collapse_superseded_drafts, feedback_title

DA = "Kan du give mig feedback på {title}? Her er hvad jeg har skrevet:\n\n{text}"
EN = "Can you give me feedback on {title}? Here is what I've written:\n\n{text}"


def _user(text: str) -> types.Content:
    return types.Content(role="user", parts=[types.Part(text=text)])


def _model(text: str) -> types.Content:
    return types.Content(role="model", parts=[types.Part(text=text)])


class _Req:
    def __init__(self, contents):
        self.contents = contents


def _texts(req) -> list[str]:
    return [p.text for c in req.contents for p in c.parts if p.text]


@pytest.mark.parametrize("lang", ["da", "en"])
def test_templates_match_the_frontend_messages(lang):
    """The backend copy of the template must be the frontend's, or nothing collapses."""
    path = Path(__file__).resolve().parents[3] / "frontend" / "messages" / lang / "workspace.json"
    frontend = json.loads(path.read_text())["WorkbenchWriting"]["feedbackRequest"]
    tpl = next(t for t in TEMPLATES if t.lang == lang)
    assert frontend == f"{tpl.head}{{title}}{tpl.tail}{{text}}"


def test_three_drafts_of_one_sheet_keep_only_the_newest_whole():
    req = _Req(
        [
            _user(DA.format(title="Undervejs (Del 2-5)", text="Protoner transporteres")),
            _model("Er det protoner?"),
            _user(DA.format(title="Undervejs (Del 2-5)", text="Protoner transporteres. Li+ vandrer")),
            _model("Ret protonerne."),
            _user(DA.format(title="Undervejs (Del 2-5)", text="Li+ ioner transporteres")),
        ]
    )
    assert collapse_superseded_drafts(req) == 2
    texts = _texts(req)
    assert texts[0].startswith("[En tidligere udgave af «Undervejs (Del 2-5)»")
    assert texts[2].startswith("[En tidligere udgave af «Undervejs (Del 2-5)»")
    assert texts[4].endswith("Li+ ioner transporteres")  # the newest, whole
    assert texts[1] == "Er det protoner?" and texts[3] == "Ret protonerne."  # tutor's replies kept
    assert sum("Protoner" in t for t in texts) == 0


def test_each_sheet_keeps_its_own_newest_draft():
    req = _Req(
        [
            _user(DA.format(title="Del 1", text="a")),
            _user(DA.format(title="Afslutning", text="b")),
            _user(DA.format(title="Del 1", text="a2")),
        ]
    )
    assert collapse_superseded_drafts(req) == 1
    texts = _texts(req)
    assert texts[0].startswith("[En tidligere")
    assert texts[1].endswith("\n\nb") and texts[2].endswith("\n\na2")


def test_english_template_and_a_title_with_a_question_mark():
    title = "Why does it fall?"
    req = _Req([_user(EN.format(title=title, text="old")), _user(EN.format(title=title, text="new"))])
    assert feedback_title(EN.format(title=title, text="x"))[0] == title
    assert collapse_superseded_drafts(req) == 1
    assert _texts(req)[0].startswith('[An earlier draft of "Why does it fall?"')


def test_a_hand_typed_feedback_question_is_never_collapsed():
    typed = "kan du give mig feedback på det her? vi har skrevet om protoner"
    req = _Req([_user(typed), _user(DA.format(title="Del 1", text="x")), _user(typed)])
    assert collapse_superseded_drafts(req) == 0
    assert _texts(req)[0] == typed


def test_the_original_parts_are_not_edited():
    """Only the request changes; the stored session event must keep every draft."""
    old = types.Part(text=DA.format(title="Del 1", text="protoner"))
    stored = types.Content(role="user", parts=[old])
    req = _Req([types.Content(role="user", parts=list(stored.parts)), _user(DA.format(title="Del 1", text="ioner"))])
    collapse_superseded_drafts(req)
    assert old.text.endswith("protoner")
    assert stored.parts[0].text.endswith("protoner")


def test_a_photo_beside_an_old_draft_is_kept():
    img = types.Part(inline_data=types.Blob(mime_type="image/png", data=b"x"))
    first = types.Content(role="user", parts=[types.Part(text=DA.format(title="Del 1", text="a")), img])
    req = _Req([first, _user(DA.format(title="Del 1", text="b"))])
    collapse_superseded_drafts(req)
    assert req.contents[0].parts[1] is img


def test_off_switch(monkeypatch):
    monkeypatch.setenv("TUTOR_COLLAPSE_DRAFTS", "0")
    req = _Req([_user(DA.format(title="Del 1", text="a")), _user(DA.format(title="Del 1", text="b"))])
    assert collapse_superseded_drafts(req) == 0


def test_fail_open_on_a_strange_request():
    assert collapse_superseded_drafts(object()) == 0
