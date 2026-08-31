"""`db/table_progress.py` — the group's data-table readings (1.1.88 M1).

Mirrors the three sibling suites (`checklist_progress`, `concept_progress`,
`writing_progress`). The load-bearing cases are the MERGE ones: the reported
defect is two students clobbering each other, so a fix whose own store replaces
rather than merges would reproduce it one layer down.
"""

from __future__ import annotations

import pytest

from db import firestore as fs_module
from db.table_progress import (
    MAX_CELL_CHARS,
    clear_progress_for_group,
    get_cells,
    get_state,
    record_cells,
)

GROUP = "grp-7b"
ACTIVITY = "act-faldtid"


@pytest.fixture(autouse=True)
def _local_mode(monkeypatch):
    """The in-memory Firestore, as the three sibling suites use.

    Without it the session-wide conftest stub answers "not found" to every read
    and swallows every write, so a merge test would pass or fail for reasons
    that have nothing to do with the merge.
    """
    monkeypatch.setenv("LOCAL_MODE", "1")
    fs_module._reset_client_for_testing()
    yield
    fs_module._reset_client_for_testing()


class TestReadEmpty:
    def test_no_document_reads_as_empty_not_unknown(self):
        assert get_cells(GROUP, ACTIVITY) == {}
        assert get_state(GROUP, ACTIVITY) == {"cells": {}, "revision": 0}

    def test_missing_ids_are_empty_rather_than_a_bad_firestore_path(self):
        """Empty group/activity must not key a document path — the same
        `400 invalid document path` the anonymous-group corner keeps producing."""
        assert get_cells("", ACTIVITY) == {}
        assert get_cells(GROUP, "") == {}
        assert get_state("", "") == {"cells": {}, "revision": 0}


class TestRecord:
    def test_records_and_reads_back(self):
        out = record_cells(GROUP, ACTIVITY, {"t1::0::tid": "0,55"})
        assert out["cells"] == {"t1::0::tid": "0,55"}
        assert out["revision"] == 1
        assert get_cells(GROUP, ACTIVITY) == {"t1::0::tid": "0,55"}

    def test_second_writer_merges_rather_than_replaces(self):
        """THE case. Two students, different rows, both readings survive."""
        record_cells(GROUP, ACTIVITY, {"t1::0::tid": "0,55"})
        out = record_cells(GROUP, ACTIVITY, {"t1::1::tid": "0,54"})
        assert out["cells"] == {"t1::0::tid": "0,55", "t1::1::tid": "0,54"}

    def test_returns_the_whole_grid_not_an_echo(self):
        """The caller pushes this to the tutor, so it must be the group's grid.

        Returning only what was sent is how the AI ends up seeing "the most
        recently entered values" with the store correct underneath it.
        """
        record_cells(GROUP, ACTIVITY, {"t1::0::tid": "0,55"})
        out = record_cells(GROUP, ACTIVITY, {"t1::1::tid": "0,54"})
        assert set(out["cells"]) == {"t1::0::tid", "t1::1::tid"}

    def test_same_cell_is_last_write_wins_with_a_bumped_revision(self):
        """Defined rather than assumed — and the revision is how the losing
        author's client learns to re-read instead of sitting on a stale value."""
        first = record_cells(GROUP, ACTIVITY, {"t1::0::tid": "0,55"})
        second = record_cells(GROUP, ACTIVITY, {"t1::0::tid": "0,58"})
        assert second["cells"]["t1::0::tid"] == "0,58"
        assert second["revision"] == first["revision"] + 1

    def test_empty_value_clears_the_cell(self):
        """A student deleting a wrong reading must be able to un-share it."""
        record_cells(GROUP, ACTIVITY, {"t1::0::tid": "0,55"})
        out = record_cells(GROUP, ACTIVITY, {"t1::0::tid": ""})
        assert "t1::0::tid" not in out["cells"]

    def test_whitespace_only_also_clears(self):
        record_cells(GROUP, ACTIVITY, {"t1::0::tid": "0,55"})
        out = record_cells(GROUP, ACTIVITY, {"t1::0::tid": "   "})
        assert out["cells"] == {}

    def test_oversized_value_is_clipped(self):
        out = record_cells(GROUP, ACTIVITY, {"t1::0::tid": "9" * (MAX_CELL_CHARS + 50)})
        assert len(out["cells"]["t1::0::tid"]) == MAX_CELL_CHARS

    def test_separate_activities_do_not_share(self):
        record_cells(GROUP, ACTIVITY, {"t1::0::tid": "0,55"})
        record_cells(GROUP, "act-other", {"t1::0::tid": "9,81"})
        assert get_cells(GROUP, ACTIVITY) == {"t1::0::tid": "0,55"}
        assert get_cells(GROUP, "act-other") == {"t1::0::tid": "9,81"}

    def test_separate_groups_do_not_share(self):
        record_cells(GROUP, ACTIVITY, {"t1::0::tid": "0,55"})
        assert get_cells("grp-other", ACTIVITY) == {}

    def test_two_tables_coexist_in_one_activity(self):
        """The cell key carries the table id, so a second table (1.1.71) needs
        nothing new from the store."""
        record_cells(GROUP, ACTIVITY, {"t1::0::tid": "0,55", "t2::0::vid": "2,1"})
        cells = get_cells(GROUP, ACTIVITY)
        assert cells["t1::0::tid"] == "0,55"
        assert cells["t2::0::vid"] == "2,1"


class TestClear:
    def test_clears_one_activity(self):
        record_cells(GROUP, ACTIVITY, {"t1::0::tid": "0,55"})
        assert clear_progress_for_group(GROUP, ACTIVITY) == 1
        assert get_cells(GROUP, ACTIVITY) == {}

    def test_clearing_a_missing_document_is_zero_not_an_error(self):
        assert clear_progress_for_group(GROUP, "act-never-used") == 0

    def test_clears_every_activity_for_the_group(self):
        record_cells(GROUP, ACTIVITY, {"t1::0::tid": "0,55"})
        record_cells(GROUP, "act-other", {"t1::0::tid": "9,81"})
        assert clear_progress_for_group(GROUP) == 2
        assert get_cells(GROUP, ACTIVITY) == {}
        assert get_cells(GROUP, "act-other") == {}

    def test_empty_group_clears_nothing(self):
        assert clear_progress_for_group("") == 0
