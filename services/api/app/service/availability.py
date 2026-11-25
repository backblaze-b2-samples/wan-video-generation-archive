"""Can a registry model run on this process's device? Decided before any download.

The Generate form greys out a model that cannot run here and the API refuses
it with 400, so a Mac never starts a multi-GB TI2V-5B download it cannot use.
"""

from app.config.models import DEMO_PRESET, FRAME_OPTIONS, MODELS, SELF_TEST_PRESET, WanModelSpec
from app.types.clips import GenerationPreset, ModelInfo, ResolutionInfo
from app.types.generation import DeviceProbe, VideoGenerator

# A card sold as "24 GB" reports less to torch (an L4 or A10G shows ~22.5 GiB),
# so the nominal requirement is compared with this much slack.
VRAM_SLACK = 0.9


def unavailable_reason(model: WanModelSpec, probe: DeviceProbe) -> str | None:
    """None when `model` can run on `probe`'s device, else a sentence saying why not."""
    if probe.device is None:
        return probe.error or "No generation device could be detected."
    need = model.min_cuda_vram_gb
    if need is None:
        return None
    if probe.device != "cuda":
        return (
            f"{model.label} needs a CUDA GPU with {need:g} GB or more of VRAM; this API "
            f"runs on {probe.device}. Use wan2.1-t2v-1.3b here, or a GPU host "
            "(infra/gpu-vm/README.md)."
        )
    if probe.vram_gb is not None and probe.vram_gb < need * VRAM_SLACK:
        return (
            f"{model.label} needs {need:g} GB or more of VRAM; this GPU has "
            f"{probe.vram_gb:.1f} GB. Use wan2.1-t2v-1.3b here."
        )
    return None


def list_models(generator: VideoGenerator, preferred: str) -> list[ModelInfo]:
    """The registry, each entry marked runnable or not on this device.

    The default is `preferred` (WAN_MODEL) when it can run here, else the first
    model that can, so the Generate form never pre-selects a model it would refuse.
    """
    loaded = generator.loaded_model_id
    probe = generator.probe()
    reasons = {m.id: unavailable_reason(m, probe) for m in MODELS.values()}
    runnable = [i for i, r in reasons.items() if r is None]
    default = preferred if preferred in runnable else next(iter(runnable), preferred)
    # Off CUDA a 480p/49-frame/30-step clip takes far longer, so start from the
    # smallest real run instead; the user can still raise every setting.
    preset = DEMO_PRESET if probe.device == "cuda" else SELF_TEST_PRESET
    recommended = GenerationPreset(
        resolution=preset["resolution"],
        num_frames=preset["num_frames"],
        num_inference_steps=preset["num_inference_steps"],
    )
    return [
        ModelInfo(
            id=m.id,
            label=m.label,
            hf_repo=m.hf_repo,
            revision=m.revision,
            license=m.license,
            fps=m.fps,
            resolutions=[
                ResolutionInfo(name=r.name, width=r.width, height=r.height)
                for r in m.resolutions
            ],
            frame_options=list(FRAME_OPTIONS),
            default_steps=m.default_steps,
            default_guidance=m.default_guidance,
            loaded=loaded == m.id,
            device=generator.device if loaded == m.id else None,
            available=reasons[m.id] is None,
            unavailable_reason=reasons[m.id],
            default=m.id == default,
            run_device=probe.device,
            recommended=recommended,
        )
        for m in MODELS.values()
    ]
