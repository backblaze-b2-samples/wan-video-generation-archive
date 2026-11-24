"""Generate, look up and delete clips; every clip lands with a manifest line.

Write order for a new clip: MP4, then settings sidecar, then manifest line. If
any step fails, the objects already written are removed, so a failed
generation leaves no object and no manifest entry.
"""

import hashlib
import json
import logging
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from app.config import layout
from app.config.models import FRAME_OPTIONS, MODELS, get_model, is_pinned
from app.repo.clip_store import ClipStore
from app.repo.manifest_store import ManifestStore
from app.repo.video_encode import encode_mp4
from app.service.errors import (
    ClipNotFoundError,
    InvalidClipRequestError,
    RegistryMismatchError,
)
from app.service.labels import clip_metadata, container_tags
from app.types.clips import (
    ClipRecord,
    DeleteClipResponse,
    GenerateClipRequest,
    ModelInfo,
    ProjectSummary,
    ResolutionInfo,
)
from app.types.generation import GenerationSpec, StepCallback, VideoGenerator

logger = logging.getLogger(__name__)

SIDECAR_EXCLUDE = {"output_key", "settings_key", "tier", "archived_at"}


def utcnow() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class PreparedGeneration:
    """A validated generation, ready to queue. Built before the job is accepted."""

    project: str
    spec: GenerationSpec
    fps: int
    license: str
    regenerated_from: str | None = None


class ClipService:
    def __init__(
        self,
        store: ClipStore,
        manifests: ManifestStore,
        generator: VideoGenerator,
        clock: Callable[[], datetime] = utcnow,
        token: Callable[[], str] = lambda: secrets.token_hex(4),
        random_seed: Callable[[], int] = lambda: secrets.randbelow(2**32),
    ):
        self.store = store
        self.manifests = manifests
        self.generator = generator
        self.clock = clock
        self._token = token
        self._random_seed = random_seed

    # --- models and projects -------------------------------------------------

    def models(self) -> list[ModelInfo]:
        loaded = self.generator.loaded_model_id
        return [
            ModelInfo(
                id=m.id,
                label=m.label,
                hf_repo=m.hf_repo,
                revision=m.revision,
                license=m.license,
                fps=m.fps,
                resolutions=[
                    ResolutionInfo(name=r.name, width=r.width, height=r.height)
                    for r in m.resolutions
                ],
                frame_options=list(FRAME_OPTIONS),
                default_steps=m.default_steps,
                default_guidance=m.default_guidance,
                loaded=loaded == m.id,
                device=self.generator.device if loaded == m.id else None,
            )
            for m in MODELS.values()
        ]

    def projects(self) -> list[ProjectSummary]:
        out = []
        for name in self.manifests.list_projects():
            records = self.manifests.read(name)
            out.append(
                ProjectSummary(
                    name=name,
                    clip_count=len(records),
                    recent_count=sum(r.tier == "recent" for r in records),
                    archive_count=sum(r.tier == "archive" for r in records),
                    manifest_key=layout.manifest_key(name),
                    last_generated_at=max((r.created_at for r in records), default=None),
                )
            )
        return out

    # --- validation ----------------------------------------------------------

    @staticmethod
    def _check_project(project: str) -> None:
        if not layout.is_valid_project(project):
            raise InvalidClipRequestError(
                "project must match ^[a-z0-9][a-z0-9-]{0,62}$ (lowercase letters, digits, hyphens)"
            )

    def prepare_generate(self, req: GenerateClipRequest) -> PreparedGeneration:
        self._check_project(req.project)
        model = get_model(req.model_id)
        if model is None:
            raise InvalidClipRequestError(
                f"Unknown model_id {req.model_id!r}; choose one of {sorted(MODELS)}"
            )
        preset = model.resolution(req.resolution)
        if preset is None:
            names = [r.name for r in model.resolutions]
            raise InvalidClipRequestError(
                f"Resolution {req.resolution!r} is not offered for {model.id}; choose one of {names}"
            )
        seed = req.seed if req.seed is not None else self._random_seed()
        spec = GenerationSpec(
            model_id=model.id,
            hf_repo=model.hf_repo,
            revision=model.revision,
            prompt=req.prompt,
            negative_prompt=req.negative_prompt or None,
            seed=seed,
            width=preset.width,
            height=preset.height,
            num_frames=req.num_frames,
            num_inference_steps=req.num_inference_steps,
            guidance_scale=req.guidance_scale,
        )
        return PreparedGeneration(req.project, spec, model.fps, model.license)

    def prepare_regenerate(self, project: str, clip_id: str) -> PreparedGeneration:
        source = self.get(project, clip_id)
        if not is_pinned(source.model, source.model_revision):
            raise RegistryMismatchError(
                f"Clip {clip_id} used {source.model}@{source.model_revision}, which is not in "
                "the pinned model registry; it cannot be regenerated exactly."
            )
        model = MODELS[source.model]
        spec = GenerationSpec(
            model_id=model.id,
            hf_repo=model.hf_repo,
            revision=model.revision,
            prompt=source.prompt,
            negative_prompt=source.negative_prompt,
            seed=source.seed,
            width=source.width,
            height=source.height,
            num_frames=source.num_frames,
            num_inference_steps=source.num_inference_steps,
            guidance_scale=source.guidance_scale,
        )
        return PreparedGeneration(project, spec, source.fps, model.license, clip_id)

    # --- generation ----------------------------------------------------------

    def run(self, prepared: PreparedGeneration, on_step: StepCallback) -> ClipRecord:
        spec = prepared.spec
        started = time.monotonic()
        video = self.generator.generate(spec, on_step)
        elapsed = round(time.monotonic() - started, 3)

        created_at = self.clock()
        clip_id = layout.make_clip_id(created_at, self._token())
        mp4_key, json_key = layout.recent_keys(prepared.project, clip_id, created_at)
        data = encode_mp4(
            video.frames,
            video.width,
            video.height,
            prepared.fps,
            container_tags(spec.model_id, spec.revision, spec.seed),
        )
        record = ClipRecord(
            clip_id=clip_id,
            project=prepared.project,
            prompt=spec.prompt,
            negative_prompt=spec.negative_prompt,
            seed=spec.seed,
            model=spec.model_id,
            model_revision=spec.revision,
            model_license=prepared.license,
            diffusers_version=video.diffusers_version,
            torch_version=video.torch_version,
            device=video.device,
            width=spec.width,
            height=spec.height,
            num_frames=spec.num_frames,
            fps=prepared.fps,
            num_inference_steps=spec.num_inference_steps,
            guidance_scale=spec.guidance_scale,
            output_key=mp4_key,
            settings_key=json_key,
            tier="recent",
            sha256=hashlib.sha256(data).hexdigest(),
            size_bytes=len(data),
            created_at=created_at,
            generation_seconds=elapsed,
            regenerated_from=prepared.regenerated_from,
        )
        self._persist(record, data)
        logger.info("Clip stored: project=%s clip_id=%s", record.project, clip_id)
        return record

    def _persist(self, record: ClipRecord, data: bytes) -> None:
        metadata = clip_metadata(record)
        sidecar = json.dumps(
            record.model_dump(mode="json", exclude=SIDECAR_EXCLUDE), indent=2
        ).encode("utf-8")
        written: list[str] = []
        try:
            self.store.put(record.output_key, data, "video/mp4", metadata)
            written.append(record.output_key)
            self.store.put(record.settings_key, sidecar, "application/json", metadata)
            written.append(record.settings_key)
            self.manifests.append(record)
        except Exception:
            for key in written:
                try:
                    self.store.delete(key)
                except RuntimeError:
                    logger.error("Cleanup failed for %s", key, exc_info=True)
            raise

    # --- lookup and delete ---------------------------------------------------

    def get(self, project: str, clip_id: str) -> ClipRecord:
        self._check_project(project)
        for record in self.manifests.read(project):
            if record.clip_id == clip_id:
                return record
        raise ClipNotFoundError(f"Clip {clip_id} not found in project {project}")

    def list_clips(
        self, project: str | None = None, tier: str = "all", q: str | None = None
    ) -> list[ClipRecord]:
        if project:
            self._check_project(project)
        projects = [project] if project else self.manifests.list_projects()
        needle = (q or "").strip().lower()
        items = [
            r
            for p in projects
            for r in self.manifests.read(p)
            if (tier == "all" or r.tier == tier)
            and (not needle or needle in r.prompt.lower() or needle in r.clip_id)
        ]
        items.sort(key=lambda r: r.created_at, reverse=True)
        return items

    def delete(self, project: str, clip_id: str) -> DeleteClipResponse:
        record = self.get(project, clip_id)
        keys = [record.output_key, record.settings_key]
        for key in keys:
            self.store.delete(key)
        self.manifests.remove(project, clip_id)
        return DeleteClipResponse(clip_id=clip_id, deleted_keys=keys)
