"""UCloud AI — sovereign, OpenAI-compatible inference run by SDU eScience.

Every token is computed in Denmark (Bitten, Sønderborg), and the service
promises that requests are never used for training. That is ADR-003's
national / self-hosted tier, reached over plain HTTPS instead of a GPU we run
ourselves. Runbook: docs/ops/runbooks/ucloud-ai.md.

A model is routed here by the ``ucloud/`` prefix on its api_name
(``ucloud/glm-5.3-flash``). Everything after the prefix is sent unchanged as
the OpenAI ``model`` field, so it must equal what the server's ``/models``
lists — ``make ucloud-smoke`` checks exactly that.

Configuration, read at call time so tests and a redeploy see the current value:

- ``UCLOUD_AI_API_KEY`` — a secret. A key can only be generated in UCloud
  while the project holds inference credits, and it is shown ONCE.
- ``UCLOUD_AI_BASE_URL`` — the "server address" shown alongside the key, the
  base LiteLLM appends ``/chat/completions`` to. It is not secret, and it is
  the same on every env.

Unset, or still the Terraform placeholder, means the provider is OFF:
``/api/models`` hides its models and ``resolve_model`` refuses with a message
naming the missing variable, rather than a 401 from somewhere inside LiteLLM.

⚠️ ROUTING A SKILL HERE DOES NOT MAKE IT SOVEREIGN. The tutor turn goes to
Denmark; these still go to Google: the compaction summarizer
(``smart_model()``, Gemini), the web/enterprise search and code-execution
sub-agents (Gemini), curriculum RAG retrieval (Vertex RAG, europe-west1) and
voice. Claim "every token in Denmark" only for a skill using none of them.
"""

from __future__ import annotations

import os

UCLOUD_PREFIX = "ucloud/"

# Terraform creates UCLOUD_AI_API_KEY with this as its first version
# (infrastructure/env/secrets.tf); the real key is added out-of-band.
_PLACEHOLDER_PREFIX = "REPLACE_ME"

# The server address is the same for every UCloud project. Fill this in once
# the first key shows it, so deploys need only the secret; the env var still
# overrides it.
DEFAULT_BASE_URL = ""


def _real(value: str | None) -> str:
    value = (value or "").strip()
    return "" if value.startswith(_PLACEHOLDER_PREFIX) else value


def ucloud_base_url() -> str:
    """The OpenAI-compatible base URL, or ``""`` when unknown."""
    return _real(os.environ.get("UCLOUD_AI_BASE_URL")) or DEFAULT_BASE_URL


def ucloud_api_key() -> str:
    """The API key, or ``""`` when unset or still the Terraform placeholder."""
    return _real(os.environ.get("UCLOUD_AI_API_KEY"))


def missing_settings() -> list[str]:
    """Names of the variables this deploy still lacks, empty when configured."""
    missing = []
    if not ucloud_base_url():
        missing.append("UCLOUD_AI_BASE_URL")
    if not ucloud_api_key():
        missing.append("UCLOUD_AI_API_KEY")
    return missing


def is_configured() -> bool:
    """Whether a ``ucloud/`` model can be called on this deploy."""
    return not missing_settings()


def served_name(api_name: str) -> str:
    """The OpenAI ``model`` field for a ``ucloud/`` api_name."""
    return api_name.removeprefix(UCLOUD_PREFIX)
