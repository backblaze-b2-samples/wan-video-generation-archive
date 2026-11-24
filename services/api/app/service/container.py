"""Wires the repo adapters into the services, once per process.

Tests swap the whole set with `set_services(build_services(fake_client, ...))`.
"""

import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.config import settings
from app.repo.b2_client import get_s3_client
from app.repo.clip_store import ClipStore
from app.repo.manifest_store import ManifestStore
from app.repo.wan_pipeline import WanGenerator
from app.service.archive import ArchiveService
from app.service.clips import ClipService, utcnow
from app.service.jobs import JobQueue
from app.service.share import ShareService
from app.types.generation import VideoGenerator


@dataclass
class Services:
    clips: ClipService
    archive: ArchiveService
    share: ShareService
    jobs: JobQueue


def build_services(
    client: Any,
    bucket: str,
    generator: VideoGenerator,
    clock: Callable[[], datetime] = utcnow,
    **clip_kwargs: Any,
) -> Services:
    store = ClipStore(client, bucket)
    manifests = ManifestStore(store)
    clips = ClipService(store, manifests, generator, clock=clock, **clip_kwargs)
    return Services(
        clips=clips,
        archive=ArchiveService(store, manifests, settings.archive_after_days, clock),
        share=ShareService(clips, store, settings.share_link_ttl_seconds, clock),
        jobs=JobQueue(clips.run, clock),
    )


_services: Services | None = None
_lock = threading.Lock()


def get_services() -> Services:
    global _services
    with _lock:
        if _services is None:
            _services = build_services(
                get_s3_client(),
                settings.b2_bucket_name,
                WanGenerator(settings.wan_device, settings.wan_cpu_offload),
            )
        return _services


def peek_services() -> Services | None:
    """The services if already built (metrics must not build them)."""
    return _services


def set_services(services: Services | None) -> None:
    global _services
    with _lock:
        _services = services
