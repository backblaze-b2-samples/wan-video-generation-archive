"""Request and response models for clips, projects, jobs and the archive."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.types.base import ResponseModel

Tier = Literal["recent", "archive"]
TierFilter = Literal["recent", "archive", "all"]
JobKind = Literal["generate", "regenerate"]
JobStatus = Literal["queued", "running", "succeeded", "failed"]
JobStage = Literal["downloading", "loading", "generating", "saving"]
FrameCount = Literal[17, 33, 49, 81, 121]

PROJECT_PATTERN = r"^[a-z0-9][a-z0-9-]{0,62}$"


class ResolutionInfo(ResponseModel):
    name: str
    width: int
    height: int


class GenerationPreset(ResponseModel):
    resolution: str
    num_frames: int
    num_inference_steps: int


class ModelInfo(ResponseModel):
    """One pinned registry entry plus whether it is loaded on the GPU now."""

    id: str
    label: str
    hf_repo: str
    revision: str = Field(description="Exact 40-hex Hugging Face commit the weights load from.")
    license: str
    fps: int
    resolutions: list[ResolutionInfo]
    frame_options: list[int]
    default_steps: int
    default_guidance: float
    loaded: bool
    device: str | None = Field(description="Device of the loaded pipeline; null when not loaded.")
    available: bool = Field(
        description="Whether this model can run on the API's device; checked before any download."
    )
    unavailable_reason: str | None = Field(
        default=None, description="Why the model cannot run here; null when available."
    )
    default: bool = Field(
        description="The model the Generate form pre-selects: WAN_MODEL if it can run, "
        "else the first model that can."
    )
    run_device: str | None = Field(
        default=None,
        description="Device this API generates on (cuda, mps or cpu), probed without loading "
        "weights; null when it cannot be determined.",
    )
    recommended: GenerationPreset = Field(
        description="Settings the Generate form starts from: the demo preset on CUDA, the light "
        "preset elsewhere, where every step is much slower."
    )


class ProjectSummary(ResponseModel):
    name: str
    clip_count: int
    recent_count: int
    archive_count: int
    held_count: int = Field(
        default=0,
        description="Recent clips held there by a live share link (counted in recent_count).",
    )
    manifest_key: str
    last_generated_at: datetime | None


class ClipRecord(ResponseModel):
    """One manifest line: everything needed to explain and reproduce a clip."""

    schema_version: int = 1
    clip_id: str
    project: str
    prompt: str
    negative_prompt: str | None
    seed: int
    model: str
    model_revision: str
    model_license: str
    diffusers_version: str | None
    torch_version: str | None
    device: str | None
    width: int
    height: int
    num_frames: int
    fps: int
    num_inference_steps: int
    guidance_scale: float
    output_key: str = Field(description="Current key of the MP4, in whichever tier it sits.")
    settings_key: str = Field(description="Current key of the settings sidecar JSON.")
    tier: Tier
    sha256: str
    size_bytes: int
    created_at: datetime
    archived_at: datetime | None = None
    ai_generated: bool = True
    ai_label: str = "AI-generated"
    generation_seconds: float
    regenerated_from: str | None = None
    share_expires_at: datetime | None = Field(
        default=None,
        description="Latest expiry of a share link minted while the clip was recent. A presigned "
        "link is bound to one key, so the age job keeps the clip in recent until then.",
    )


class ClipList(ResponseModel):
    items: list[ClipRecord]


class GenerateClipRequest(BaseModel):
    """Text-to-video request. Omitting `seed` picks a random one that is still recorded."""

    project: str = Field(default="demo", pattern=PROJECT_PATTERN)
    prompt: str = Field(min_length=1, max_length=2000)
    negative_prompt: str | None = Field(default=None, max_length=2000)
    seed: int | None = Field(default=None, ge=0, le=2**32 - 1)
    model_id: str = "wan2.2-ti2v-5b"
    resolution: str = "480p"
    num_frames: FrameCount = 49
    num_inference_steps: int = Field(default=30, ge=1, le=100)
    guidance_scale: float = Field(default=5.0, ge=0.0, le=20.0)


class GenerationJob(ResponseModel):
    job_id: str
    kind: JobKind
    status: JobStatus
    project: str
    prompt: str
    stage: JobStage | None = Field(
        default=None, description="What a running job is doing now; null when not running."
    )
    stage_detail: str | None = Field(
        default=None, description="Human-readable progress for the stage (e.g. bytes downloaded)."
    )
    stage_started_at: datetime | None = Field(
        default=None, description="When the current stage began; null when not running."
    )
    step: int
    total_steps: int
    clip_id: str | None = None
    regenerated_from: str | None = None
    error: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


class DeleteClipResponse(ResponseModel):
    clip_id: str
    deleted_keys: list[str]


class ShareRequest(BaseModel):
    expires_in_seconds: int | None = Field(
        default=None,
        description="Link lifetime; defaults to SHARE_LINK_TTL_SECONDS, clamped to 60..604800.",
    )


class ShareLink(ResponseModel):
    url: str
    expires_at: datetime
    key: str
    tier: Tier


class AgeJobRequest(BaseModel):
    older_than_days: int | None = Field(
        default=None, ge=0, description="Defaults to ARCHIVE_AFTER_DAYS (30)."
    )
    as_of: datetime | None = Field(
        default=None, description="Clock override; defaults to now. A future date previews aging."
    )
    dry_run: bool = False
    include_held: bool = Field(
        default=False,
        description="Also move clips held by a live share link; those links stop working.",
    )


class ArchiveMove(ResponseModel):
    clip_id: str
    from_key: str
    to_key: str
    created_at: datetime


class ArchiveHold(ResponseModel):
    """A clip old enough to archive, held in recent while a share link for its key is live."""

    clip_id: str
    share_expires_at: datetime


class AgeJobResult(ResponseModel):
    project: str
    as_of: datetime
    cutoff: datetime
    moved: list[ArchiveMove]
    kept_count: int = Field(description="Clips left in recent, including `held` ones.")
    held: list[ArchiveHold] = Field(
        default_factory=list,
        description="Old enough, but kept in recent until their share link expires.",
    )
    released: list[ArchiveHold] = Field(
        default_factory=list,
        description="Clips moved despite a live share link (include_held); those links now fail.",
    )
    dry_run: bool
