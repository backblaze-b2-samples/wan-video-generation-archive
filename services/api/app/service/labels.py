"""The AI-generated label, written three ways on every clip.

1. S3 object metadata (`x-amz-meta-ai-generated`, ...), visible on a head request.
2. MP4 container tags (`ai_generated`, `ai_label`, `comment`), carried by the file itself.
3. The manifest line (`ai_generated: true`, `ai_label`).
"""

from app.types.clips import ClipRecord


def clip_metadata(record: ClipRecord) -> dict[str, str]:
    """S3 user metadata written on every clip (x-amz-meta-*)."""
    return {
        "ai-generated": "true",
        "ai-label": record.ai_label,
        "sha256": record.sha256,
        "clip-id": record.clip_id,
        "project": record.project,
        "model": record.model,
        "model-revision": record.model_revision,
        "seed": str(record.seed),
    }


def container_tags(model_id: str, revision: str, seed: int) -> dict[str, str]:
    return {
        "comment": f"AI-generated video. Model {model_id}@{revision}, seed {seed}.",
        "ai_generated": "true",
        "ai_label": "AI-generated",
        "model": model_id,
        "model_revision": revision,
        "seed": str(seed),
    }
