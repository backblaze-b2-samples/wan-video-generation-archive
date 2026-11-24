"""Frames to MP4 with AI-generated container tags, and reading those tags back.

Uses the static ffmpeg build that `imageio-ffmpeg` ships, so no system ffmpeg
is required. `-movflags +use_metadata_tags` keeps custom keys (`ai_generated`,
`model_revision`, ...) in the MP4 container; `+faststart` moves the index to
the front so a presigned link starts playing before the download finishes.
"""

import subprocess
import tempfile
from pathlib import Path

import imageio_ffmpeg


def _ffmpeg() -> str:
    return imageio_ffmpeg.get_ffmpeg_exe()


def encode_mp4(
    frames: list[bytes], width: int, height: int, fps: int, tags: dict[str, str]
) -> bytes:
    """Encode RGB24 frames to an H.264 MP4 carrying `tags` as container metadata."""
    if not frames:
        raise ValueError("cannot encode a clip with no frames")
    metadata_args: list[str] = []
    for key, value in tags.items():
        metadata_args += ["-metadata", f"{key}={value}"]
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "clip.mp4"
        writer = imageio_ffmpeg.write_frames(
            str(out),
            (width, height),
            fps=fps,
            codec="libx264",
            pix_fmt_in="rgb24",
            pix_fmt_out="yuv420p",
            quality=None,
            macro_block_size=2,
            output_params=[
                "-crf",
                "18",
                *metadata_args,
                "-movflags",
                "+faststart+use_metadata_tags",
            ],
            ffmpeg_log_level="error",
        )
        writer.send(None)  # prime the generator
        for frame in frames:
            writer.send(frame)
        writer.close()
        return out.read_bytes()


def read_container_tags(path: str | Path) -> dict[str, str]:
    """Return the container-level tags of a media file (`ffmpeg -f ffmetadata`)."""
    result = subprocess.run(
        [_ffmpeg(), "-v", "error", "-i", str(path), "-f", "ffmetadata", "-"],
        capture_output=True,
        text=True,
        check=True,
    )
    tags: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if not line or line.startswith((";", "[")) or "=" not in line:
            continue
        key, value = line.split("=", 1)
        tags[key.strip().lower()] = value.strip()
    return tags


def read_container_tags_from_bytes(data: bytes) -> dict[str, str]:
    with tempfile.NamedTemporaryFile(suffix=".mp4") as tmp:
        tmp.write(data)
        tmp.flush()
        return read_container_tags(tmp.name)
