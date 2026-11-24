"""Plain data passed between the clip service and a video generator.

Kept free of torch/numpy so the service layer and the unit tests never import
the ML stack.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class GenerationSpec:
    model_id: str
    hf_repo: str
    revision: str
    prompt: str
    negative_prompt: str | None
    seed: int
    width: int
    height: int
    num_frames: int
    num_inference_steps: int
    guidance_scale: float


@dataclass
class GeneratedVideo:
    """Raw RGB24 frames (each `width * height * 3` bytes) plus provenance."""

    frames: list[bytes]
    width: int
    height: int
    device: str
    diffusers_version: str | None = None
    torch_version: str | None = None
    extra: dict[str, str] = field(default_factory=dict)


# Called after each denoising step with (step, total_steps).
StepCallback = Callable[[int, int], None]


class VideoGenerator(Protocol):
    @property
    def loaded_model_id(self) -> str | None: ...

    @property
    def device(self) -> str | None: ...

    def generate(self, spec: GenerationSpec, on_step: StepCallback) -> GeneratedVideo: ...
