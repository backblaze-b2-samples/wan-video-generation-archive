<!-- last_verified: 2026-11-24 -->
# Feature: Clip Generation

## Purpose
Turn a text prompt into a short MP4 with an open Wan model on one GPU, and store it in B2 already labelled AI-generated and recorded in its project's manifest.

## Used By
- UI: `/generate` (`GenerateForm`, `JobProgress`)
- API: `POST /clips` (202, returns a `GenerationJob`), `GET /jobs`, `GET /jobs/{job_id}`, `GET /models`, `GET /projects`
- Job: the in-process job queue (`service/jobs.py`), one worker thread
- CLI: `python services/api/scripts/wan_archive.py generate ...`

## Core Functions
- `services/api/app/config/models.py`: pinned registry (`MODELS`, `FRAME_OPTIONS`, `SELF_TEST_PRESET`, `DEMO_PRESET`)
- `services/api/app/repo/wan_pipeline.py`: `WanGenerator` (lazy torch/diffusers import, one pipeline resident), `select_device()`, `resolve_offload()`, `check_hf_endpoint()`
- `services/api/app/repo/video_encode.py`: `encode_mp4()` and `read_container_tags()`
- `services/api/app/service/clips.py`: `ClipService.prepare_generate()` (validation) and `ClipService.run()` (generate, encode, write)
- `services/api/app/service/labels.py`: `clip_metadata()` and `container_tags()`, the AI-generated label
- `services/api/app/service/jobs.py`: `JobQueue` (FIFO, single worker, step progress)
- `apps/web/src/components/clips/generate-form.tsx`, `apps/web/src/components/clips/job-progress.tsx`

## Canonical Files
- Model adapter pattern: `services/api/app/repo/wan_pipeline.py`
- Service write order: `services/api/app/service/clips.py`

## Inputs
- `GenerateClipRequest`: `project` (`^[a-z0-9][a-z0-9-]{0,62}$`, default `demo`), `prompt` (1..2000 chars), `negative_prompt?`, `seed?` (0..2^32-1; omitted means random but recorded), `model_id` (registry id, default `wan2.2-ti2v-5b`), `resolution` (preset of that model, default `480p`), `num_frames` (17, 33, 49, 81 or 121; default 49), `num_inference_steps` (1..100; the UI offers 20/30/40/50, default 30), `guidance_scale` (0..20, default 5.0)
- Env: `WAN_MODEL`, `WAN_DEVICE`, `WAN_CPU_OFFLOAD`, `HF_HOME`, `HF_TOKEN` (optional), `HF_ENDPOINT` (if set, must be `https://huggingface.co`)

## Outputs
- `GenerationJob` with `status` `queued | running | succeeded | failed`, `step` / `total_steps`, and `clip_id` once stored
- Objects: `video/recent/<project>/<YYYY-MM-DD>/<clip_id>.mp4` (`video/mp4`) and `<clip_id>.json` (settings sidecar)
- One new line in `video/manifests/<project>.jsonl` (see [manifest.md](manifest.md))
- The label, three ways: S3 metadata `ai-generated: true`, `ai-label: AI-generated` (plus `sha256`, `clip-id`, `project`, `model`, `model-revision`, `seed`); MP4 container tags `ai_generated=true`, `ai_label=AI-generated`, `comment`, `model`, `model_revision`, `seed` (written with `-movflags +faststart+use_metadata_tags`); and the manifest fields `ai_generated`, `ai_label`

## Flow
- The API validates the request against the registry (unknown model or resolution: 400) and resolves the seed, then queues the job and answers 202
- The worker loads the pinned pipeline if needed: `DiffusionPipeline.from_pretrained(repo, revision=<40-hex sha>)`, VAE in float32, the rest in bfloat16 on CUDA/MPS (float32 on CPU). Device: `WAN_DEVICE=auto` picks CUDA, then MPS, then CPU. On CUDA with less than 40 GB VRAM, `WAN_CPU_OFFLOAD=auto` enables model CPU offload
- Denoising reports each step; the UI polls `GET /jobs/{job_id}` every 1.5 s
- Frames are encoded to H.264 MP4 with the bundled ffmpeg (`imageio-ffmpeg`), hashed (SHA-256), then written: MP4, sidecar, manifest line. A failure at any step deletes what was already written

## Edge Cases
- Generation raises (out of memory, download failure) -> job `failed` with the error; no object, no manifest line
- Manifest write fails after the MP4 is stored -> MP4 and sidecar are deleted, job `failed`
- `HF_ENDPOINT` points at a mirror -> the worker refuses to load the model
- A second job while one runs -> waits in the FIFO (`queued`); jobs are lost on API restart, stored clips are not
- First run on a fresh host -> the weights download from huggingface.co before step 1 (minutes); the job stays `running` at step 0 meanwhile

## UX States
- Empty: form with safe defaults shown as placeholders and descriptions (no autofill button)
- Loading: "Queuing..." on submit, then a progress bar with step N / total
- Error: toast for a rejected request; red error text on a failed job
- Done: "Open clip" link to `/clip`

## Verification
- Test files: `services/api/tests/test_clip_generation.py`, `services/api/tests/test_clip_routes.py`, `services/api/tests/test_model_registry.py`, `services/api/live_tests/test_wan_archive_e2e.py`
- Required cases: objects + metadata + manifest line written; MP4 container tags read back from a real tiny MP4; random seed recorded; generation failure and manifest failure leave nothing; registry rejects unknown model/resolution; device autodetect order; offload rule; API never imports torch
- Focused verify command: `pnpm test:api`
- Live: `RUN_LIVE_B2_TESTS=1 pnpm test:live:gpu` on a host with the model stack (see [verification.md](../verification.md))
- Default pre-PR verify command: `pnpm verify`
- Pass criteria: unit tests green without torch installed; the live self-test green on the GPU host

## Related Docs
- [manifest.md](manifest.md)
- [regeneration.md](regeneration.md)
- [infra/gpu-vm/README.md](../../infra/gpu-vm/README.md)
