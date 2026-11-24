from fastapi import APIRouter

from app.service.container import get_services
from app.types import ModelInfo

router = APIRouter()


@router.get("/models", response_model=list[ModelInfo])
def list_models():
    """The pinned model registry and which entry is loaded on the device now."""
    return get_services().clips.models()
