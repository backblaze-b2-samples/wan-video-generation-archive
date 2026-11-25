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
# Called when a generation enters a stage: (stage, optional human-readable detail).
# Stages: "downloading" (first-run weights), "loading", "generating", "saving".
StageCallback = Callable[[str, str | None], None]


@dataclass(frozen=True)
class DeviceProbe:
    """The accelerator generation would run on, found without loading a model.

    `device` is None when it cannot be determined (for example, torch is not
    installed); `error` then says why.
    """

    device: str | None
    vram_gb: float | None = None
    error: str | None = None


class VideoGenerator(Protocol):
    @property
    def loaded_model_id(self) -> str | None: ...

    @property
    def device(self) -> str | None: ...

    def probe(self) -> DeviceProbe: ...

    def generate(
        self,
        spec: GenerationSpec,
        on_step: StepCallback,
        on_stage: StageCallback | None = None,
    ) -> GeneratedVideo: ...
