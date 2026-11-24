from app.types.base import ResponseModel


class UploadStats(ResponseModel):
    """Aggregate whole-bucket figures (object count, size, downloads)."""

    total_files: int
    total_size_bytes: int
    total_size_human: str
    uploads_today: int
    total_downloads: int
