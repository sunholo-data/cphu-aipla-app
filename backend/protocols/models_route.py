"""GET /api/models — unauthenticated model list for the skill-settings UI.

Returns the structured model registry from backend/config/models.yaml.
No auth required: the model list is not sensitive.
Compaction config is internal and not included in the response.

UCloud AI models are listed only on a deploy that has its key
(``config.ucloud.is_configured``): offering a teacher a model that refuses
every turn is worse than not offering it.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from config import ucloud
from config.models import ModelEntry, load_models_config

router = APIRouter(prefix="/api", tags=["models"])


class ModelsResponse(BaseModel):
    models: list[ModelEntry]
    defaults: dict[str, str]
    platform_default: str


@router.get("/models", response_model=ModelsResponse)
async def list_models() -> ModelsResponse:
    """Return all supported models grouped by provider."""
    cfg = load_models_config()
    hidden = set() if ucloud.is_configured() else {"ucloud"}
    return ModelsResponse(
        models=[m for m in cfg.models if m.provider not in hidden],
        defaults={provider: model_id for provider, model_id in cfg.defaults.items() if provider not in hidden},
        platform_default=cfg.platform_default,
    )
