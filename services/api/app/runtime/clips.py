# Sync `def` handlers: the chain is blocking boto3 (see runtime/files.py).
# SECURITY: unauthenticated, single-tenant demo stance (docs/SECURITY.md).
from typing import Literal

from fastapi import APIRouter

from app.runtime.errors import ERROR_RESPONSES, call
from app.service.container import get_services
from app.types import (
    ClipList,
    ClipRecord,
    DeleteClipResponse,
    GenerateClipRequest,
    GenerationJob,
    ShareLink,
    ShareRequest,
)

router = APIRouter()


@router.post(
    "/clips", response_model=GenerationJob, status_code=202, responses=ERROR_RESPONSES
)
def generate_clip(body: GenerateClipRequest):
    """Queue a text-to-video generation. Poll /jobs/{job_id} for progress."""
    services = get_services()
    prepared = call(lambda: services.clips.prepare_generate(body))
    return services.jobs.submit("generate", prepared)


@router.get("/clips", response_model=ClipList, responses=ERROR_RESPONSES)
def list_clips(
    project: str | None = None,
    tier: Literal["recent", "archive", "all"] = "all",
    q: str | None = None,
):
    """Manifest entries across projects (or one), newest first; `q` matches prompt or id."""
    items = call(lambda: get_services().clips.list_clips(project, tier, q))
    return ClipList(items=items)


@router.get(
    "/projects/{project}/clips/{clip_id}", response_model=ClipRecord, responses=ERROR_RESPONSES
)
def get_clip(project: str, clip_id: str):
    return call(lambda: get_services().clips.get(project, clip_id))


@router.delete(
    "/projects/{project}/clips/{clip_id}",
    response_model=DeleteClipResponse,
    responses=ERROR_RESPONSES,
)
def delete_clip(project: str, clip_id: str):
    """Delete the MP4 and sidecar, then remove the manifest line."""
    return call(lambda: get_services().clips.delete(project, clip_id))


@router.post(
    "/projects/{project}/clips/{clip_id}/share",
    response_model=ShareLink,
    responses=ERROR_RESPONSES,
)
def share_clip(project: str, clip_id: str, body: ShareRequest):
    """Expiring presigned GET (inline video/mp4) for a recent or archived clip."""
    share = get_services().share
    return call(lambda: share.share(project, clip_id, body.expires_in_seconds))


@router.post(
    "/projects/{project}/clips/{clip_id}/regenerate",
    response_model=GenerationJob,
    status_code=202,
    responses=ERROR_RESPONSES,
)
def regenerate_clip(project: str, clip_id: str):
    """Re-run a clip from its manifest prompt, seed, model and revision."""
    services = get_services()
    prepared = call(lambda: services.clips.prepare_regenerate(project, clip_id))
    return services.jobs.submit("regenerate", prepared)
