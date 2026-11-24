"""GPU validation gate for the pinned Wan model (run on the CUDA host).

Runs the demo preset (480p, 49 frames, 30 steps, guidance 5.0) with model CPU
offload OFF, records `torch.cuda.max_memory_allocated()`, and fails when peak
allocated memory exceeds 24 GiB, the single-consumer-GPU claim of the model
card. When it does exceed, it re-runs with offload ON and reports whether that
setting brings the peak under the limit. Nothing is written to B2.

    python scripts/gpu_preflight.py [--model wan2.2-ti2v-5b] [--limit-gib 24]

Prints one Markdown table row for the README "GPU validation" table.
"""

import argparse
import json
import time
from datetime import UTC, datetime

from _bootstrap import out

from app.config.models import DEMO_PRESET, get_model
from app.repo.wan_pipeline import WanGenerator
from app.types.generation import GenerationSpec

PROMPT = "A red fox trotting through fresh snow at dawn, cinematic"


def _measure(model_id: str, offload: str) -> dict:
    import torch

    model = get_model(model_id)
    if model is None:
        raise SystemExit(f"unknown model {model_id!r}")
    preset = model.resolution(DEMO_PRESET["resolution"])
    spec = GenerationSpec(
        model_id=model.id,
        hf_repo=model.hf_repo,
        revision=model.revision,
        prompt=PROMPT,
        negative_prompt=None,
        seed=42,
        width=preset.width,
        height=preset.height,
        num_frames=DEMO_PRESET["num_frames"],
        num_inference_steps=DEMO_PRESET["num_inference_steps"],
        guidance_scale=DEMO_PRESET["guidance_scale"],
    )
    generator = WanGenerator(device_preference="cuda", cpu_offload=offload)
    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    started = time.monotonic()
    video = generator.generate(spec, lambda step, total: None)
    seconds = time.monotonic() - started
    peak = torch.cuda.max_memory_allocated() / 1024**3
    generator.unload()
    return {
        "offload": offload,
        "peak_gib": round(peak, 2),
        "seconds": round(seconds, 1),
        "frames": len(video.frames),
        "torch": video.torch_version,
        "diffusers": video.diffusers_version,
        "gpu": torch.cuda.get_device_name(0),
        "revision": model.revision,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure peak VRAM of the demo preset.")
    parser.add_argument("--model", default="wan2.2-ti2v-5b")
    parser.add_argument("--limit-gib", type=float, default=24.0)
    args = parser.parse_args()

    import torch

    if not torch.cuda.is_available():
        out("gpu_preflight: no CUDA device visible; run this on the GPU host.")
        return 2

    runs = [_measure(args.model, "off")]
    if runs[0]["peak_gib"] > args.limit_gib:
        runs.append(_measure(args.model, "on"))
    out(json.dumps(runs, indent=2))

    first = runs[0]
    preset = (
        f"{DEMO_PRESET['resolution']}, {DEMO_PRESET['num_frames']} frames, "
        f"{DEMO_PRESET['num_inference_steps']} steps"
    )
    out(
        f"| {datetime.now(UTC).date()} | {first['gpu']} | `{first['revision'][:12]}` | {preset} "
        f"| {first['peak_gib']} GiB (offload off) | {first['seconds']} s | | |"
    )
    if first["peak_gib"] <= args.limit_gib:
        out(f"PASS: peak {first['peak_gib']} GiB <= {args.limit_gib} GiB with offload off")
        return 0
    if len(runs) > 1 and runs[1]["peak_gib"] <= args.limit_gib:
        out(
            f"FAIL (offload off): {first['peak_gib']} GiB > {args.limit_gib} GiB. "
            f"WAN_CPU_OFFLOAD=on brings it to {runs[1]['peak_gib']} GiB."
        )
    else:
        out(f"FAIL: peak exceeds {args.limit_gib} GiB even with offload on")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
