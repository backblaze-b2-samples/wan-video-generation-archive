"""Object key layout for clips, sidecars and manifests (one bucket).

    video/recent/<project>/<YYYY-MM-DD>/<clip_id>.mp4  (+ .json settings sidecar)
    video/archive/<project>/<YYYY-MM>/<clip_id>.mp4    (+ .json), month from created_at
    video/manifests/<project>.jsonl                    one ClipRecord per line

Every key this app writes is derived here, so the layout has one definition.
"""

import re
from datetime import datetime

VIDEO_PREFIX = "video/"
RECENT_PREFIX = f"{VIDEO_PREFIX}recent/"
ARCHIVE_PREFIX = f"{VIDEO_PREFIX}archive/"
MANIFEST_PREFIX = f"{VIDEO_PREFIX}manifests/"
# Keys under these prefixes belong to a manifest entry; the bucket explorer
# refuses to delete them so no manifest line is ever orphaned.
MANAGED_PREFIXES: tuple[str, ...] = (RECENT_PREFIX, ARCHIVE_PREFIX, MANIFEST_PREFIX)

PROJECT_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
CLIP_ID_RE = re.compile(r"^\d{8}T\d{6}Z-[0-9a-f]{8}$")


def is_valid_project(project: str) -> bool:
    return bool(PROJECT_RE.fullmatch(project))


def is_valid_clip_id(clip_id: str) -> bool:
    return bool(CLIP_ID_RE.fullmatch(clip_id))


def make_clip_id(created_at: datetime, token_hex8: str) -> str:
    return f"{created_at.strftime('%Y%m%dT%H%M%SZ')}-{token_hex8}"


def recent_keys(project: str, clip_id: str, created_at: datetime) -> tuple[str, str]:
    base = f"{RECENT_PREFIX}{project}/{created_at.strftime('%Y-%m-%d')}/{clip_id}"
    return f"{base}.mp4", f"{base}.json"


def archive_keys(project: str, clip_id: str, created_at: datetime) -> tuple[str, str]:
    base = f"{ARCHIVE_PREFIX}{project}/{created_at.strftime('%Y-%m')}/{clip_id}"
    return f"{base}.mp4", f"{base}.json"


def manifest_key(project: str) -> str:
    return f"{MANIFEST_PREFIX}{project}.jsonl"


def project_from_manifest_key(key: str) -> str | None:
    if not key.startswith(MANIFEST_PREFIX) or not key.endswith(".jsonl"):
        return None
    name = key[len(MANIFEST_PREFIX) : -len(".jsonl")]
    return name if is_valid_project(name) else None


def is_managed_key(key: str) -> bool:
    return key.startswith(MANAGED_PREFIXES)
