# Sync `def` handlers: the chain is blocking boto3 (see runtime/files.py).
from fastapi import APIRouter

from app.runtime.errors import ERROR_RESPONSES, call
from app.service.container import get_services
from app.types import AgeJobRequest, AgeJobResult, ProjectSummary

router = APIRouter()


@router.get("/projects", response_model=list[ProjectSummary])
def list_projects():
    """Every project that has a manifest under video/manifests/."""
    return call(lambda: get_services().clips.projects())


@router.post(
    "/projects/{project}/archive", response_model=AgeJobResult, responses=ERROR_RESPONSES
)
def age_project(project: str, body: AgeJobRequest):
    """Move clips older than N days to video/archive/ and rewrite their manifest keys."""
    archive = get_services().archive
    return call(
        lambda: archive.age(project, body.older_than_days, body.as_of, body.dry_run)
    )
