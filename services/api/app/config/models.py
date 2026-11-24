"""Pinned registry of the open video models this sample can run.

Every entry names a Hugging Face repository AND an exact 40-hex commit, so a
manifest line (model id + revision) always points at the weights that produced
the clip. Regenerate refuses any entry whose model or revision is not listed
here. Only Apache-2.0 models are offered; models whose license restricts
commercial use (LTX-Video, LTX-2) are excluded on purpose.

Weights load only from huggingface.co (see repo/wan_pipeline.py); nothing from
the model repositories is copied into this repo.
"""

from dataclasses import dataclass

HF_BASE_URL = "https://huggingface.co"

# Wan generates 4k+1 frames; these are the selectable lengths.
FRAME_OPTIONS: tuple[int, ...] = (17, 33, 49, 81, 121)
# Denoising step choices the UI offers (the API accepts 1..100).
STEP_OPTIONS: tuple[int, ...] = (20, 30, 40, 50)


@dataclass(frozen=True)
class ResolutionPreset:
    name: str
    height: int
    width: int


@dataclass(frozen=True)
class WanModelSpec:
    id: str
    label: str
    hf_repo: str
    revision: str
    license: str
    role: str
    fps: int
    resolutions: tuple[ResolutionPreset, ...]
    default_steps: int = 30
    default_guidance: float = 5.0

    def resolution(self, name: str) -> ResolutionPreset | None:
        return next((r for r in self.resolutions if r.name == name), None)


DEFAULT_MODEL_ID = "wan2.2-ti2v-5b"

MODELS: dict[str, WanModelSpec] = {
    spec.id: spec
    for spec in (
        WanModelSpec(
            id="wan2.2-ti2v-5b",
            label="Wan2.2 TI2V-5B (text-to-video)",
            hf_repo="Wan-AI/Wan2.2-TI2V-5B-Diffusers",
            revision="b8fff7315c768468a5333511427288870b2e9635",
            license="apache-2.0",
            role="validation + demo",
            fps=24,
            resolutions=(
                ResolutionPreset("low", 384, 672),
                ResolutionPreset("480p", 480, 832),
                ResolutionPreset("720p", 704, 1280),
            ),
        ),
        WanModelSpec(
            id="wan2.1-t2v-1.3b",
            label="Wan2.1 T2V-1.3B (local development)",
            hf_repo="Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
            revision="0fad780a534b6463e45facd96134c9f345acfa5b",
            license="apache-2.0",
            role="local development only",
            fps=16,
            resolutions=(
                ResolutionPreset("low", 320, 576),
                ResolutionPreset("480p", 480, 832),
            ),
        ),
    )
}

# Smallest real run: what the live self-test and a smoke check use.
SELF_TEST_PRESET = {"resolution": "low", "num_frames": 17, "num_inference_steps": 20}
# The demo default the Generate form pre-selects and gpu_preflight.py measures.
DEMO_PRESET = {
    "resolution": "480p",
    "num_frames": 49,
    "num_inference_steps": 30,
    "guidance_scale": 5.0,
}


def get_model(model_id: str) -> WanModelSpec | None:
    return MODELS.get(model_id)


def is_pinned(model_id: str, revision: str) -> bool:
    """True when (model, revision) is exactly an entry of this registry."""
    spec = MODELS.get(model_id)
    return spec is not None and spec.revision == revision
