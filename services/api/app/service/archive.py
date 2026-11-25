"""Age job: move clips older than N days from video/recent/ to video/archive/.

Per clip the order is copy -> verify -> rewrite manifest -> delete recent:
  1. server-side copy of the MP4 and its sidecar (metadata preserved),
  2. head the archive copy and check its size and `sha256` metadata,
  3. point the manifest line at the archive keys,
  4. only then delete the recent copies.
A crash at any step leaves the clip readable at the key its manifest names;
the worst case is a leftover recent copy, never a missing clip.

A share link is a presigned GET bound to one key, so moving a clip would break
every link minted for it. A due clip whose `share_expires_at` is still in the
future (wall clock, since links expire in real time even when `as_of` previews
a future date) is held in recent and reported in `held`; a later run moves it.
`include_held` is the deliberate way through: held clips move anyway, their
hold is cleared, and they are reported in `released` because their links stop
working.

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
from app.service.clips import is_held, utcnow
from app.service.errors import ClipNotFoundError, InvalidClipRequestError
from app.types.clips import AgeJobResult, ArchiveHold, ArchiveMove, ClipRecord

logger = logging.getLogger(__name__)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def _hold(record: ClipRecord) -> ArchiveHold:
    return ArchiveHold(clip_id=record.clip_id, share_expires_at=record.share_expires_at)


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
        include_held: bool = False,
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

        old = [r for r in records if r.tier == "recent" and r.created_at <= cutoff]
        wall = self.clock()
        live = [_hold(r) for r in old if is_held(r, wall)]
        held = [] if include_held else live
        released = live if include_held else []
        held_ids = {h.clip_id for h in held}
        due = [r for r in old if r.clip_id not in held_ids]
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
            if not dry_run and not self._move(record, include_held):
                # A link was minted while the copy ran: the clip stays recent.
                moves.pop()
                held.append(_hold(self._current(record)))
                due.remove(record)
        logger.info(
            "Age job: project=%s moved=%d held=%d released=%d dry_run=%s",
            project, len(moves), len(held), len(released), dry_run,
        )
        return AgeJobResult(
            project=project,
            as_of=now,
            cutoff=cutoff,
            moved=moves,
            kept_count=sum(1 for r in records if r.tier == "recent") - len(due),
            held=held,
            released=released,
            dry_run=dry_run,
        )

    def _move(self, record: ClipRecord, include_held: bool = False) -> bool:
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
        if not self._swap(archived, include_held):
            self.store.delete(to_mp4)
            self.store.delete(to_json)
            return False
        self.store.delete(record.output_key)
        self.store.delete(record.settings_key)
        return True

    def _swap(self, archived: ClipRecord, include_held: bool = False) -> bool:
        """Point the manifest at the archive keys unless a share link now holds the clip.

        With `include_held` the hold is ignored and cleared: the clip moves and its
        outstanding links stop working.
        """
        swapped = False

        def change(records: list[ClipRecord]) -> list[ClipRecord]:
            nonlocal swapped
            out = []
            for r in records:
                if r.clip_id == archived.clip_id and (
                    include_held or not is_held(r, self.clock())
                ):
                    swapped = True
                    expires = None if include_held else r.share_expires_at
                    r = archived.model_copy(update={"share_expires_at": expires})
                out.append(r)
            return out

        self.manifests.update(archived.project, change)
        return swapped

    def _current(self, record: ClipRecord) -> ClipRecord:
        found = (r for r in self.manifests.read(record.project) if r.clip_id == record.clip_id)
        return next(found, record)
