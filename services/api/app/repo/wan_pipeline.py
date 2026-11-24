"""Wan text-to-video through Diffusers, on whatever accelerator is present.

torch and diffusers are imported lazily inside methods: the API, the unit
tests and CI run without the ML stack (requirements-model.txt adds it).

Device: `WAN_DEVICE=auto` picks CUDA, then Apple MPS, then CPU. CPU works but
is impractically slow for video; MPS is best-effort for the 1.3B dev model.
Offload: `WAN_CPU_OFFLOAD=auto` enables model CPU offload on CUDA devices with
less than 40 GB of VRAM. Only one pipeline is resident at a time.
"""

import logging
import os
import threading
from collections.abc import Callable
from typing import Any

from app.config.models import HF_BASE_URL
from app.types.generation import GeneratedVideo, GenerationSpec, StepCallback

logger = logging.getLogger(__name__)

DEVICE_CHOICES = ("auto", "cuda", "mps", "cpu")
OFFLOAD_CHOICES = ("auto", "on", "off")
OFFLOAD_AUTO_BELOW_GB = 40.0


def check_hf_endpoint(value: str | None) -> None:
    """Weights load only from huggingface.co: refuse any other HF_ENDPOINT."""
    if value and value.rstrip("/") != HF_BASE_URL:
        raise RuntimeError(
            f"HF_ENDPOINT={value!r} is not allowed: model weights load only from "
            f"{HF_BASE_URL}. Unset HF_ENDPOINT or set it to {HF_BASE_URL}."
        )


def select_device(
    preference: str,
    cuda_available: Callable[[], bool],
    mps_available: Callable[[], bool],
) -> str:
    """Resolve `WAN_DEVICE` to a concrete device; never hard-requires a GPU."""
    pref = (preference or "auto").lower()
    if pref not in DEVICE_CHOICES:
        raise ValueError(f"WAN_DEVICE must be one of {DEVICE_CHOICES}, got {preference!r}")
    if pref != "auto":
        return pref
    if cuda_available():
        return "cuda"
    if mps_available():
        return "mps"
    return "cpu"


def resolve_offload(setting: str, device: str, vram_gb: float | None) -> bool:
    """Whether to enable model CPU offload. Only meaningful on CUDA."""
    value = (setting or "auto").lower()
    if value not in OFFLOAD_CHOICES:
        raise ValueError(f"WAN_CPU_OFFLOAD must be one of {OFFLOAD_CHOICES}, got {setting!r}")
    if device != "cuda":
        return False
    if value == "auto":
        return vram_gb is not None and vram_gb < OFFLOAD_AUTO_BELOW_GB
    return value == "on"


def frames_to_rgb24(frames: Any) -> tuple[list[bytes], int, int]:
    """Diffusers `output_type="np"` frames (F, H, W, 3) floats in [0, 1] -> RGB24 bytes.

    Returns (frames, width, height) taken from the array itself.
    """
    import numpy as np

    arr = (np.clip(np.asarray(frames), 0.0, 1.0) * 255.0).round().astype(np.uint8)
    return [np.ascontiguousarray(f).tobytes() for f in arr], int(arr.shape[2]), int(arr.shape[1])


class WanGenerator:
    """Holds at most one loaded Wan pipeline and runs one generation at a time."""

    def __init__(self, device_preference: str = "auto", cpu_offload: str = "auto"):
        self._device_preference = device_preference
        self._cpu_offload = cpu_offload
        self._pipe: Any = None
        self._loaded_key: tuple[str, str] | None = None
        self._loaded_model_id: str | None = None
        self._device: str | None = None
        self._offload = False
        self._lock = threading.Lock()

    @property
    def loaded_model_id(self) -> str | None:
        return self._loaded_model_id

    @property
    def device(self) -> str | None:
        return self._device

    @property
    def offload_enabled(self) -> bool:
        return self._offload

    def _load(self, spec: GenerationSpec) -> None:
        if self._loaded_key == (spec.hf_repo, spec.revision):
            return
        check_hf_endpoint(os.environ.get("HF_ENDPOINT"))
        import torch
        from diffusers import AutoencoderKLWan, DiffusionPipeline

        self.unload()
        device = select_device(
            self._device_preference,
            torch.cuda.is_available,
            lambda: bool(getattr(torch.backends, "mps", None))
            and torch.backends.mps.is_available(),
        )
        dtype = torch.float32 if device == "cpu" else torch.bfloat16
        logger.info("Loading %s@%s on %s", spec.hf_repo, spec.revision, device)
        # The Wan VAE is numerically sensitive: keep it in float32.
        vae = AutoencoderKLWan.from_pretrained(
            spec.hf_repo, subfolder="vae", revision=spec.revision, torch_dtype=torch.float32
        )
        pipe = DiffusionPipeline.from_pretrained(
            spec.hf_repo, revision=spec.revision, vae=vae, torch_dtype=dtype
        )
        vram_gb = None
        if device == "cuda":
            vram_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3
        self._offload = resolve_offload(self._cpu_offload, device, vram_gb)
        if self._offload:
            pipe.enable_model_cpu_offload()
        else:
            pipe.to(device)
        self._pipe = pipe
        self._device = device
        self._loaded_key = (spec.hf_repo, spec.revision)
        self._loaded_model_id = spec.model_id

    def unload(self) -> None:
        if self._pipe is None:
            return
        self._pipe = None
        self._loaded_key = None
        self._loaded_model_id = None
        import gc

        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:  # pragma: no cover - torch absent means nothing was loaded
            pass

    def generate(self, spec: GenerationSpec, on_step: StepCallback) -> GeneratedVideo:
        with self._lock:
            self._load(spec)
            import diffusers
            import torch

            def _callback(_pipe, step: int, _timestep, callback_kwargs):
                on_step(step + 1, spec.num_inference_steps)
                return callback_kwargs

            # A CPU generator gives the same initial noise for a seed on any device.
            generator = torch.Generator(device="cpu").manual_seed(spec.seed)
            result = self._pipe(
                prompt=spec.prompt,
                negative_prompt=spec.negative_prompt or None,
                height=spec.height,
                width=spec.width,
                num_frames=spec.num_frames,
                num_inference_steps=spec.num_inference_steps,
                guidance_scale=spec.guidance_scale,
                generator=generator,
                output_type="np",
                callback_on_step_end=_callback,
            )
            frames, width, height = frames_to_rgb24(result.frames[0])
            return GeneratedVideo(
                frames=frames,
                width=width,
                height=height,
                device=self._device or "cpu",
                diffusers_version=diffusers.__version__,
                torch_version=torch.__version__,
            )
