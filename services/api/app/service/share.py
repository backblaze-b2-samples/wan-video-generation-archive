"""Expiring share links for a clip in either tier (presigned GET, inline video/mp4)."""

from collections.abc import Callable
from datetime import datetime, timedelta

from app.repo.clip_store import ClipStore
from app.service.clips import ClipService, utcnow
from app.service.errors import ClipNotFoundError
from app.types.clips import ShareLink

MIN_TTL_SECONDS = 60
MAX_TTL_SECONDS = 604_800  # 7 days, the S3 presigned-URL ceiling


def clamp_ttl(requested: int | None, default: int) -> int:
    value = default if requested is None else requested
    return max(MIN_TTL_SECONDS, min(MAX_TTL_SECONDS, int(value)))


class ShareService:
    def __init__(
        self,
        clips: ClipService,
        store: ClipStore,
        default_ttl: int,
        clock: Callable[[], datetime] = utcnow,
    ):
        self.clips = clips
        self.store = store
        self.default_ttl = default_ttl
        self.clock = clock

    def share(self, project: str, clip_id: str, expires_in: int | None = None) -> ShareLink:
        record = self.clips.get(project, clip_id)
        if self.store.head(record.output_key) is None:
            raise ClipNotFoundError(f"Object {record.output_key} is missing from the bucket")
        ttl = clamp_ttl(expires_in, self.default_ttl)
        url = self.store.presign_inline_video(record.output_key, ttl)
        return ShareLink(
            url=url,
            expires_at=self.clock() + timedelta(seconds=ttl),
            key=record.output_key,
            tier=record.tier,
        )
