"""The argument schemas a sim's ``commands`` declare (1.1.133 M0).

A deliberately SMALL subset of JSON Schema, checked twice:

- at catalogue load (``check_schema``) — a sim cannot declare a keyword this
  module does not enforce. A schema that names ``pattern`` or ``oneOf`` and has
  it silently ignored would look validated and not be;
- on every tutor command (``validate_args``) — the model's arguments are checked
  against the declared schema BEFORE anything reaches the student's browser.

Why not the ``jsonschema`` package: it is only a transitive dependency here, and
the full language is the wrong size. The sim's handler is hand-written
JavaScript that reads a handful of flat fields; the catalogue should be able to
say exactly that much and no more.
"""

from __future__ import annotations

from typing import Any

#: Every keyword a command schema may use. Anything else is refused at load.
_KEYWORDS = frozenset(
    {
        "type",
        "properties",
        "required",
        "enum",
        "items",
        "minimum",
        "maximum",
        "maxLength",
        "maxItems",
        "description",
        "additionalProperties",
    }
)

_TYPES = frozenset({"object", "string", "number", "integer", "boolean", "array"})


def check_schema(schema: Any, *, path: str = "args") -> None:
    """Raise ``ValueError`` unless ``schema`` uses only the supported subset.

    The top level must be ``type: object`` — a command's arguments are always a
    flat-ish object, because that is what the sim's ``command(name, args)``
    receives.
    """
    if not isinstance(schema, dict):
        raise ValueError(f"{path}: a schema must be a mapping")
    unknown = set(schema) - _KEYWORDS
    if unknown:
        raise ValueError(f"{path}: unsupported schema keyword(s) {sorted(unknown)} — supported: {sorted(_KEYWORDS)}")
    typ = schema.get("type")
    if typ is not None and typ not in _TYPES:
        raise ValueError(f"{path}: unknown type {typ!r}")
    if path == "args" and typ != "object":
        raise ValueError("args: a command's top-level schema must be `type: object`")
    if "enum" in schema:
        enum = schema["enum"]
        if not isinstance(enum, list) or not enum:
            raise ValueError(f"{path}: enum must be a non-empty list")
    props = schema.get("properties", {})
    if not isinstance(props, dict):
        raise ValueError(f"{path}: properties must be a mapping")
    for name, sub in props.items():
        check_schema(sub, path=f"{path}.{name}")
    required = schema.get("required", [])
    if not isinstance(required, list) or any(r not in props for r in required):
        raise ValueError(f"{path}: every required name must be a declared property")
    if "items" in schema:
        check_schema(schema["items"], path=f"{path}[]")


def _type_ok(typ: str, value: Any) -> bool:
    if typ == "object":
        return isinstance(value, dict)
    if typ == "array":
        return isinstance(value, list)
    if typ == "string":
        return isinstance(value, str)
    if typ == "boolean":
        return isinstance(value, bool)
    if typ == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if typ == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return False


def validate_args(schema: dict, value: Any, *, path: str = "args") -> list[str]:
    """Every way ``value`` fails ``schema``, as sentences the model can act on.

    Empty list means valid. Unknown properties are refused unless the schema
    says ``additionalProperties: true`` — a model that invents a field gets told,
    rather than the sim silently ignoring it.
    """
    errors: list[str] = []
    typ = schema.get("type")
    if typ is not None and not _type_ok(typ, value):
        return [f"{path} must be {typ}"]
    if "enum" in schema and value not in schema["enum"]:
        return [f"{path} must be one of {schema['enum']}"]
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append(f"{path} must be >= {schema['minimum']}")
        if "maximum" in schema and value > schema["maximum"]:
            errors.append(f"{path} must be <= {schema['maximum']}")
    if isinstance(value, str) and "maxLength" in schema and len(value) > schema["maxLength"]:
        errors.append(f"{path} must be at most {schema['maxLength']} characters")
    if isinstance(value, list):
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path} must have at most {schema['maxItems']} items")
        if "items" in schema:
            for i, item in enumerate(value):
                errors.extend(validate_args(schema["items"], item, path=f"{path}[{i}]"))
    if isinstance(value, dict):
        props = schema.get("properties", {})
        for req in schema.get("required", []):
            if req not in value:
                errors.append(f"{path}.{req} is required")
        for key, sub_value in value.items():
            if key in props:
                errors.extend(validate_args(props[key], sub_value, path=f"{path}.{key}"))
            elif not schema.get("additionalProperties", False):
                errors.append(f"{path}.{key} is not an argument of this command (allowed: {sorted(props) or 'none'})")
    return errors


def describe_args(schema: dict) -> str:
    """A one-line signature for the tool description, e.g.
    ``event (required): one of nymaane|foerste|…``."""
    props = schema.get("properties", {})
    if not props:
        return "no arguments"
    required = set(schema.get("required", []))
    parts: list[str] = []
    for name, sub in props.items():
        bits = [name + (" (required)" if name in required else "")]
        if "enum" in sub:
            bits.append("one of " + "|".join(str(v) for v in sub["enum"]))
        elif sub.get("type") == "array" and "enum" in sub.get("items", {}):
            bits.append("list of " + "|".join(str(v) for v in sub["items"]["enum"]))
        elif "type" in sub:
            bits.append(sub["type"])
        if sub.get("description"):
            bits.append(f"— {sub['description']}")
        parts.append(": ".join(bits[:2]) + (" " + " ".join(bits[2:]) if len(bits) > 2 else ""))
    return "; ".join(parts)


__all__ = ["check_schema", "describe_args", "validate_args"]
