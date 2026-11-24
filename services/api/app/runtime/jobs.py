from fastapi import APIRouter, HTTPException

from app.service.container import get_services
from app.types import GenerationJob

router = APIRouter()


@router.get("/jobs", response_model=list[GenerationJob])
def list_jobs():
    """Generation jobs held in memory by this API process, newest first."""
    return get_services().jobs.list()


@router.get(
    "/jobs/{job_id}",
    response_model=GenerationJob,
    responses={404: {"description": "Unknown job id"}},
)
def get_job(job_id: str):
    job = get_services().jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
