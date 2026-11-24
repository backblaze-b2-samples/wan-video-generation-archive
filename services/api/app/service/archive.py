"""Age job: move clips older than N days from video/recent/ to video/archive/.

Per clip the order is copy -> verify -> rewrite manifest -> delete recent:
  1. server-side copy of the MP4 and its sidecar (metadata preserved),
  2. head the archive copy and check its size and `sha256` metadata,
  3. point the manifest line at the archive keys,
  4. only then delete the recent copies.
A crash at any step leaves the clip readable at the key its manifest names;
the worst case is a leftover recent copy, never a missing clip.

Age is measured from the manifest's `created_at`, not LastModified, because a
copy resets LastModified. `as_of` overrides the clock so a future date can
preview (or test) aging.
"""

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from app.config import layout
from app.repo.clip_store import ClipStore
from app.repo.manifest_store import ManifestStore
from app.service.clips import utcnow
from app.service.errors import ClipNotFoundError, InvalidClipRequestError
from app.types.clips import AgeJobResult, ArchiveMove, ClipRecord

logger = logging.getLogger(__name__)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


class ArchiveService:
    def __init__(
        self,
        store: ClipStore,
        manifests: ManifestStore,
        default_days: int,
        clock: Callable[[], datetime] = utcnow,
    ):
        self.store = store
        self.manifests = manifests
        self.default_days = default_days
        self.clock = clock

    def age(
        self,
        project: str,
        older_than_days: int | None = None,
        as_of: datetime | None = None,
        dry_run: bool = False,
    ) -> AgeJobResult:
        if not layout.is_valid_project(project):
            raise InvalidClipRequestError("invalid project name")
        days = self.default_days if older_than_days is None else older_than_days
        if days < 0:
            raise InvalidClipRequestError("older_than_days must be >= 0")
        now = _aware(as_of) if as_of else self.clock()
        cutoff = now - timedelta(days=days)
        records = self.manifests.read(project)
        if not records and project not in self.manifests.list_projects():
            raise ClipNotFoundError(f"Project {project} has no manifest")

        due = [r for r in records if r.tier == "recent" and r.created_at <= cutoff]
        moves: list[ArchiveMove] = []
        for record in due:
            to_mp4, _ = layout.archive_keys(project, record.clip_id, record.created_at)
            moves.append(
                ArchiveMove(
                    clip_id=record.clip_id,
                    from_key=record.output_key,
                    to_key=to_mp4,
                    created_at=record.created_at,
                )
            )
            if not dry_run:
                self._move(record)
        logger.info(
            "Age job: project=%s moved=%d dry_run=%s", project, len(moves), dry_run
        )
        return AgeJobResult(
            project=project,
            as_of=now,
            cutoff=cutoff,
            moved=moves,
            kept_count=sum(1 for r in records if r.tier == "recent") - len(due),
            dry_run=dry_run,
        )

    def _move(self, record: ClipRecord) -> None:
        to_mp4, to_json = layout.archive_keys(record.project, record.clip_id, record.created_at)
        self.store.copy(record.output_key, to_mp4)
        head = self.store.head(to_mp4)
        if (
            head is None
            or head.size != record.size_bytes
            or head.metadata.get("sha256") != record.sha256
        ):
            raise RuntimeError(
                f"Archive copy of {record.clip_id} failed verification; recent copy kept"
            )
        self.store.copy(record.settings_key, to_json)
        if self.store.head(to_json) is None:
            raise RuntimeError(f"Sidecar copy of {record.clip_id} missing; recent copy kept")

        archived = record.model_copy(
            update={
                "output_key": to_mp4,
                "settings_key": to_json,
                "tier": "archive",
                "archived_at": self.clock(),
            }
        )
        self.manifests.replace(archived)
        self.store.delete(record.output_key)
        self.store.delete(record.settings_key)
