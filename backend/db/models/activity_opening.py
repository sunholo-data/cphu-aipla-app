"""Shared bounds for student-facing activity openings on every write path."""

from typing import Annotated

from pydantic import Field, StringConstraints

OpeningText = Annotated[str, Field(max_length=1500)]
StarterPrompts = Annotated[
    list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]],
    Field(max_length=4),
]
