import logging
import re

from app.config import settings
from app.config.layout import is_managed_key
from app.repo import (
    delete_file,
    get_download_count,
    get_file_metadata,
    get_object_bytes,
    get_presigned_url,
    get_upload_stats,
    increment_download_count,
    list_files,
    prewarm_listing,
)
from app.service.metadata import extract_metadata
from app.types import FileMetadata, FileMetadataDetail, UploadStats
from app.types.formatting import humanize_bytes

logger = logging.getLogger(__name__)

_DANGEROUS_KEY_RE = re.compile(r"(\.\./|/\.\.|\\|%2e%2e|%00|\x00)")


class FileKeyError(Exception):
    """Raised when a file key is invalid."""

    def __init__(self, detail: str = "Invalid file key"):
        self.detail = detail
        super().__init__(detail)


class FileNotFoundServiceError(Exception):
    """Raised when a file is not found.

    Named distinctly from the built-in ``FileNotFoundError`` so it never
    shadows it at module scope — code here (and in callers) can rely on the
    built-in meaning what it says.
    """

    def __init__(self, detail: str = "File not found"):
        self.detail = detail
        super().__init__(detail)


class FileProtectedError(Exception):
    """Raised when the explorer tries to delete a key a manifest depends on.

    Clips, their sidecars and the manifests live under video/recent/,
    video/archive/ and video/manifests/. Deleting one of those objects here
    would leave a manifest line pointing at nothing, so the explorer refuses
    and the Library's clip delete (which also removes the line) is the way.
    """

    def __init__(self, key: str):
        self.detail = (
            f"'{key}' belongs to a clip manifest. Delete the clip from the Library "
            "(clip detail page) so its manifest entry is removed too."
        )
        super().__init__(self.detail)


class FileTooLargeServiceError(Exception):
    """Raised when an object is too large to recompute detailed metadata for.

    Detailed extraction downloads and buffers the whole object in memory, so
    objects above the `max_file_size` ceiling are refused rather than risking the
    API process's memory.
    """

    def __init__(self, detail: str = "File too large for detailed metadata"):
        self.detail = detail
        super().__init__(detail)


def validate_key(key: str) -> None:
    """Reject empty keys, path-traversal patterns, and — when configured — keys
    outside the allowed prefix.

    `settings.allowed_key_prefix` is empty by default, so any key shape is
    accepted (the by-key routes deliberately support arbitrary folders and
    reserved-word segments). Set it to confine key ops to a prefix like
    "video/" when the bucket also holds non-app data.
    """
    if not key:
        raise FileKeyError()
    if _DANGEROUS_KEY_RE.search(key.lower()):
        raise FileKeyError()
    prefix = settings.allowed_key_prefix
    if prefix and not key.startswith(prefix):
        raise FileKeyError()


def warm_listing_cache() -> None:
    """Warm the shared bucket-listing cache in the background.

    Called once at startup (see `main.lifespan`). Both `/files` and
    `/files/stats` need a full listing, so warming it here moves the one
    unavoidable slow scan off whichever page the first user happens to open.
    Never raises: a warm-up failure just means the first request pays as before.
    """
    logger.info("Warming bucket listing cache")
    prewarm_listing()


def get_files(prefix: str = "", limit: int = 100) -> list[FileMetadata]:
    # SECURITY: this lists the whole bucket (or `prefix`) with no per-user
    # filter — see docs/SECURITY.md. A multi-tenant clone must scope this to
    # the caller's own prefixes, or users see each other's files.
    if limit < 1 or limit > 1000:
        raise ValueError("Limit must be between 1 and 1000")
    # list_files paginates the whole prefix (not just the first 1000 keys).
    # Sort newest-first here so the endpoint's "newest first" contract holds
    # regardless of repo ordering, then slice to the requested limit.
    files = list_files(prefix=prefix)
    files.sort(key=lambda f: f.uploaded_at, reverse=True)
    return files[:limit]


def get_stats() -> UploadStats:
    data = get_upload_stats()
    data["total_downloads"] = get_download_count()
    return UploadStats(**data)


def get_file(key: str) -> FileMetadata:
    validate_key(key)
    metadata = get_file_metadata(key)
    if not metadata:
        raise FileNotFoundServiceError()
    return metadata


def get_file_detail(key: str) -> FileMetadataDetail:
    """Recompute rich metadata (checksums, image/PDF fields) for a stored object.

    Extraction is not persisted, so the bucket explorer would otherwise only
    ever see the core object fields. This downloads the object on demand and runs
    `extract_metadata()`.

    It buffers the whole object in memory, so we `head` first to reject objects
    above `max_file_size` before downloading. Raises FileKeyError (invalid key),
    FileNotFoundServiceError (missing / deleted mid-read), or
    FileTooLargeServiceError (over the ceiling).
    """
    validate_key(key)
    metadata = get_file_metadata(key)
    if not metadata:
        raise FileNotFoundServiceError()
    if metadata.size_bytes > settings.max_file_size:
        raise FileTooLargeServiceError(
            "File too large for detailed metadata. "
            f"Max size: {humanize_bytes(settings.max_file_size)}"
        )
    data = get_object_bytes(key)
    return extract_metadata(
        data, metadata.filename, metadata.content_type, metadata.uploaded_at
    )


def _presigned_url_for(key: str, disposition: str) -> str:
    """Validate `key`, confirm the object exists, and presign it."""
    validate_key(key)
    metadata = get_file_metadata(key)
    if not metadata:
        raise FileNotFoundServiceError()
    return get_presigned_url(
        key, filename=metadata.filename, disposition=disposition
    )


def get_preview_url(key: str) -> str:
    """Return an *inline* presigned URL without recording a download.

    Used by the preview modal for rendering images / PDFs inline, so the URL
    must ask B2 for `Content-Disposition: inline` — with `attachment` (the
    download default) a browser downloads the file instead of painting it and
    the PDF preview pane stays blank. Opening a preview is also not a
    user-initiated download, so it must not inflate the download counter.
    """
    return _presigned_url_for(key, "inline")


def get_download_url(key: str) -> str:
    """Return an *attachment* presigned URL and record it as a download."""
    url = _presigned_url_for(key, "attachment")
    increment_download_count()
    return url


def remove_file(key: str) -> None:
    """Validate key and delete the file. Raises RuntimeError on B2 failure.

    Raises FileProtectedError for keys under the managed video/ prefixes.
    """
    validate_key(key)
    if is_managed_key(key):
        raise FileProtectedError(key)
    delete_file(key)
