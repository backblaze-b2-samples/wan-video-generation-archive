# Initial scaffold plan: wan-video-generation-archive

Starter kit: `backblaze-b2-samples/vibe-coding-starter-kit` at commit `84b2e372f46f9ad96712590d91476b7477e777fa`.
Published repository: `backblaze-b2-samples/wan-video-generation-archive`.

## 1. Purpose

**Problem:** Generated video piles up fast, and a clip without its prompt, seed and exact model version cannot be explained, reproduced or safely shared once it ages out of the working folder.
**For:** ML and media engineers who run an open video model on their own GPU and must keep every output traceable as it ages.
**What it does:**
- Generates short clips with Wan2.2 TI2V-5B through Diffusers on one GPU, at a pinned model revision
- Records prompt, seed, model, revision, license and checksum for every clip in a per-project manifest
- Moves clips past a configurable age to an archive prefix and rewrites their manifest keys
- Shares any recent or archived clip through an expiring presigned link
- Regenerates a clip from its manifest entry's prompt, seed and model revision

**Where B2 fits:** B2 holds the clips, their settings and the manifests in one bucket, so outputs stay findable after archiving and are shared by signed link without making the bucket public.

Out of scope: a web frontend beyond a minimal UI over the API, transcoding, streaming, multi-GPU or batch scheduling, model fine-tuning, user accounts, image-to-video conditioning (text-to-video only, so the manifest fully describes each clip), and any model whose license restricts commercial use. LTX-Video and LTX-2 are excluded on license grounds and are not offered as options.

### Pre-build confirmation (Wan2.2 TI2V-5B on one 24 GB CUDA GPU)

- Upstream model card for `Wan-AI/Wan2.2-TI2V-5B-Diffusers` states the model runs text-to-video at 720p/24 fps on a single consumer GPU with at least 24 GB VRAM (RTX 4090 class), and ships a Diffusers integration.
- The Diffusers repository's `model_index.json` at the pinned revision declares `WanPipeline` (`WanTransformer3DModel`, `AutoencoderKLWan`, `UMT5EncoderModel`, `UniPCMultistepScheduler`, `expand_timesteps: true`), loadable with `diffusers>=0.35`.
- The 24 GB claim is checked by `services/api/scripts/gpu_preflight.py` on the GPU host (a 48 GB NVIDIA A40 for the reference run): it runs the demo preset, records `torch.cuda.max_memory_allocated()`, and fails if peak allocated memory exceeds 24 GiB with CPU offload off, or reports the offload setting that brings it under. Its output goes into the README "GPU validation" table.

### Models (pinned, huggingface.co only)

| id (`WAN_MODEL`) | Hugging Face repo | Pinned revision | License | Role | fps | Resolution presets (h x w) |
|---|---|---|---|---|---|---|
| `wan2.2-ti2v-5b` (default) | `Wan-AI/Wan2.2-TI2V-5B-Diffusers` | `b8fff7315c768468a5333511427288870b2e9635` | Apache-2.0 | validation + demo | 24 | `low` 384x672, `480p` 480x832, `720p` 704x1280 |
| `wan2.1-t2v-1.3b` | `Wan-AI/Wan2.1-T2V-1.3B-Diffusers` | `0fad780a534b6463e45facd96134c9f345acfa5b` | Apache-2.0 | local development only | 16 | `low` 320x576, `480p` 480x832 |

- Frame counts are `4k+1`: selector `17 | 33 | 49 | 81 | 121`. Self-test preset: `low`, 17 frames, 20 steps. Demo default: `480p`, 49 frames, 30 steps, guidance 5.0.
- The registry is a typed constant in `app/config/models.py`. Every entry carries a 40-hex revision and `license: "apache-2.0"`; a test asserts both. Weights load with `DiffusionPipeline.from_pretrained(repo, revision=<sha>)` (VAE in float32, rest bf16 on CUDA). Nothing from the model repositories (configs, example scripts, prompt extenders) is copied into this repo.
- `HF_ENDPOINT`, if set, must equal `https://huggingface.co`; otherwise the worker refuses to load (weights come only from huggingface.co). Neither model is gated, so `HF_TOKEN` is optional.

## 2. Architecture delta from vibe-coding-starter-kit

| keep (as-is) | trim (remove) | add (new) |
|---|---|---|
| Layered FastAPI (`types/ config/ repo/ service/ runtime/`), structured logging, `/health`, `/metrics`, rate limit, CORS-last ordering | Upload feature: `runtime/upload.py`, `service/upload.py`, `repo/b2_upload.py`, `types/upload.py`, upload tests, `/upload` page, `components/upload/*`, `upload-queue-context.tsx`, `upload-status.ts`, `upload-file-types.ts` and their tests, `e2e/upload.spec.ts` (clips only enter B2 through the model, so the "every clip is labelled and in a manifest" invariant holds) | `app/config/models.py` model registry (section 1 table) |
| **Bucket explorer** (`/files`, `file-browser.tsx`, preview, metadata panel, file routes) | Dashboard: `components/dashboard/*` (stats cards, upload chart, recent uploads) and `docs/features/dashboard.md`; `/` becomes the Library | `app/repo/wan_pipeline.py`: lazy torch/diffusers import, device autodetect CUDA, then MPS, then CPU, `WAN_DEVICE` override, `WAN_CPU_OFFLOAD=auto|on|off` (auto = on when VRAM < 40 GB), one loaded pipeline at a time, progress callback |
| Metadata extraction for the explorer's metadata panel | Deploy configs that cannot host a torch GPU worker: root `vercel.json`, `services/api/vercel.json`, `services/api/index.py`, `test_vercel_entrypoint.py`, `railway.json`, `services/api/railway.json`, `infra/vercel/`, `infra/railway/` | `app/repo/video_encode.py`: frames to MP4 through `imageio-ffmpeg` with `-movflags +faststart+use_metadata_tags` and container tags (`comment`, `ai_generated=true`, `ai_label=AI-generated`, `model`, `model_revision`, `seed`); `read_container_tags()` via `ffmpeg -i <file> -f ffmetadata -` |
| Settings page + `settings-form.tsx` exemplar (fields rewritten, see below) | | `app/repo/clip_store.py`: put clip + settings sidecar, managed copy recent to archive (metadata preserved), head, delete, presigned GET (inline `video/mp4`) |
| `/design` page, theme, command palette, sidebar, health banner | | `app/repo/manifest_store.py`: read/write `video/manifests/<project>.jsonl` (read-modify-write under a per-project `threading.Lock`; single API process is the single writer, documented) |
| OpenAPI export, `pnpm gen:api`, `pnpm gen:docs`, doctor, setup, CI workflow | | `app/service/clips.py` (generate, lookup, delete), `service/archive.py` (age job with injectable clock), `service/share.py`, `service/jobs.py` (in-process FIFO, one worker thread, one GPU job at a time; not a batch scheduler) |
| `live_tests/test_b2_connectivity.py` | | `app/runtime/clips.py`, `runtime/projects.py`, `runtime/jobs.py`, `runtime/models.py` |
| | | `services/api/scripts/wan_archive.py` CLI over the service layer: `generate`, `age [--as-of ISO] [--dry-run]`, `lookup`, `share`, `regenerate`, so the Vultr run and a cron age job need no UI |
| | | `services/api/scripts/gpu_preflight.py` (section 1) |
| | | `live_tests/test_wan_archive_e2e.py` (section 4, self-test) |
| | | Web: Library `/` (sample asset explorer scoped to `video/`), Generate `/generate`, Clip detail `/clip?project=&id=`, Archive `/archive` |
| | | `infra/gpu-vm/README.md`: Vultr A40 runbook (driver check, `uv`/venv, `HF_HOME` on local disk, SSH tunnel to the web UI) |

Notes:
- **Bucket explorer tension.** Deleting a `video/recent/` or `video/archive/` object from the explorer would orphan its manifest entry. The explorer stays; `DELETE /files/{key}` returns `409` with a message pointing to the Library for keys under `video/recent/`, `video/archive/` and `video/manifests/`. Browse, preview and download are unchanged.
- **Minimal UI.** A full web frontend is out of scope, but a full-bucket explorer and a clip library make the storage layout visible, so both stay. The UI is kept to the four screens above plus the kept explorer, settings and design pages, with no extra features.
- **Dependencies.** `requirements.txt` stays light (FastAPI, boto3, Pydantic, Pillow, pypdf, `imageio-ffmpeg`); `requirements-model.txt` adds `torch`, `diffusers` (pin, at least 0.35), `transformers`, `accelerate`, `ftfy`, `sentencepiece`. Unit tests and CI never import torch; `repo/wan_pipeline.py` imports it lazily. `test_dependency_lock.py` covers both files.
- **Deployment.** `deployment_targets` is empty: the API needs a CUDA host. Local dev runs both services with `pnpm dev`; the GPU run is documented in `infra/gpu-vm/README.md`.

## 3. B2 surface

S3-compatible API only, no b2-native calls. One `boto3` client in `repo/b2_client.py` with `Config(user_agent_extra="b2ai-wan-video-generation-archive", signature_version="s3v4")`, endpoint `https://s3.<B2_REGION>.backblazeb2.com` derived from `B2_REGION`.

| Operation | Why |
|---|---|
| `put_object` | store a clip (`video/mp4`), its settings sidecar JSON and the rewritten manifest |
| `get_object` | read a project manifest and a settings sidecar |
| `head_object` | confirm a copied archive object (size, `sha256` metadata) before deleting the recent copy; `/health` probe |
| `copy_object` (managed `client.copy`, `MetadataDirective=COPY`) | move a clip and its sidecar from `video/recent/` to `video/archive/` keeping its AI-generated metadata |
| `delete_object` | remove the recent copy after a verified archive copy; delete a clip |
| `list_objects_v2` | list projects (`video/manifests/`), and the kept full-bucket explorer |
| presigned GET | expiring share links (inline playback) and explorer downloads |

Key layout (`b2_key_prefix`: `video/`):
- `video/recent/<project>/<YYYY-MM-DD>/<clip_id>.mp4` and `<clip_id>.json` (settings sidecar)
- `video/archive/<project>/<YYYY-MM>/<clip_id>.mp4` and `<clip_id>.json`, month taken from the clip's `created_at`
- `video/manifests/<project>.jsonl`, one `ClipRecord` per line

`project` matches `^[a-z0-9][a-z0-9-]{0,62}$`; `clip_id` is `<YYYYMMDDTHHMMSSZ>-<8 hex>`. Age is computed from the manifest's `created_at` (copies reset `LastModified`).

Object metadata on every clip: `ai-generated: true`, `ai-label: AI-generated`, `sha256`, `clip-id`, `project`, `model`, `model-revision`, `seed`. The prompt lives in the manifest and sidecar only.

### API endpoints (recorded once)

Kept unchanged: `GET /health`, `GET /metrics`, `GET /files`, `GET /files/stats`, `GET /files/{key}`, `GET /files/{key}/download`. Changed: `DELETE /files/{key}` (409 under managed `video/` prefixes). Removed: every `/upload*` route.

| Path | Method | Request model | Response model |
|---|---|---|---|
| `/models` | GET | none | `list[ModelInfo]` (id, label, hf_repo, revision, license, fps, resolutions, frame_options, default_steps, default_guidance, loaded, device) |
| `/projects` | GET | none | `list[ProjectSummary]` (name, clip_count, recent_count, archive_count, manifest_key, last_generated_at) |
| `/clips` | POST | `GenerateClipRequest` (project, prompt, negative_prompt?, seed?, model_id, resolution, num_frames, num_inference_steps, guidance_scale) | `GenerationJob` (202) |
| `/clips` | GET | query: project?, tier `recent|archive|all`, q? | `ClipList` (items: `list[ClipRecord]`) |
| `/projects/{project}/clips/{clip_id}` | GET | none | `ClipRecord` |
| `/projects/{project}/clips/{clip_id}` | DELETE | none | `DeleteClipResponse` (clip_id, deleted_keys) |
| `/projects/{project}/clips/{clip_id}/share` | POST | `ShareRequest` (expires_in_seconds) | `ShareLink` (url, expires_at, key, tier) |
| `/projects/{project}/clips/{clip_id}/regenerate` | POST | none | `GenerationJob` (202) |
| `/projects/{project}/archive` | POST | `AgeJobRequest` (older_than_days?, as_of?, dry_run) | `AgeJobResult` (as_of, cutoff, moved: `list[ArchiveMove]`, kept_count, dry_run) |
| `/jobs` | GET | none | `list[GenerationJob]` |
| `/jobs/{job_id}` | GET | none | `GenerationJob` (job_id, kind `generate|regenerate`, status `queued|running|succeeded|failed`, step, total_steps, clip_id?, error?, created_at, started_at?, finished_at?) |

`ClipRecord` (manifest line, primary entity): schema_version, clip_id, project, prompt, negative_prompt, seed, model, model_revision, model_license, diffusers_version, torch_version, device, width, height, num_frames, fps, num_inference_steps, guidance_scale, output_key, settings_key, tier, sha256, size_bytes, created_at, archived_at, ai_generated (always true), ai_label ("AI-generated"), generation_seconds, regenerated_from.

Rules: `seed` omitted means a random seed that is still recorded; share TTL default `SHARE_LINK_TTL_SECONDS` (3600), clamped to 60..604800; `as_of` is the clock override (defaults to now) and is also exposed as `--as-of` in the CLI; regenerate refuses with 409 when the entry's model or revision is not in the pinned registry; a generation failure leaves no object and no manifest line.

## 4. Key features

1. **Clip generation** (`/generate`): Wan2.2 TI2V-5B text-to-video via Diffusers, queued one job at a time, written to `video/recent/` with an AI-generated label in MP4 tags, object metadata and the manifest.
2. **Clip library** (`/`): sample asset explorer scoped to `video/`, filter by project and tier, inline player, detail view with the full manifest entry.
3. **Prompt-and-seed manifest**: one JSONL per project; every entry resolves to the clip's current key in either tier.
4. **Archive age job** (`/archive`): moves clips older than N days to `video/archive/<project>/<yyyy-mm>/` and rewrites manifest keys; dry run and `as_of` clock override.
5. **Expiring share links**: presigned GET for recent or archived clips with a TTL selector.
6. **Regenerate from manifest**: re-runs a clip from its entry's prompt, seed, model and revision and records `regenerated_from`.

Kept: Bucket explorer (`/files`), Settings (`/settings`), Metadata extraction.

### Provider and deployment

| Feature | Provider / model | deployment | Est. cost per full demo run | Key env var |
|---|---|---|---|---|
| Clip generation, Regenerate | Wan2.2 TI2V-5B (`Wan-AI/Wan2.2-TI2V-5B-Diffusers`) through Diffusers + PyTorch; Wan2.1 T2V 1.3B for local development | `local` | $0 in API fees; only the GPU host's hourly rate while it runs | none (`HF_TOKEN` optional) |

Core, local by definition (an open model on one GPU is the sample's point). Device autodetect CUDA, then Apple MPS, then CPU, overridable with `WAN_DEVICE`. MPS is best-effort for the 1.3B development model in bf16; CPU works but is impractically slow and is documented as such. No external API provider: generation calls Diffusers directly, which is the integration this sample demonstrates.

### Primary-entity lifecycle: `ClipRecord` (a generated clip)

| Verb | UI | Where |
|---|---|---|
| create | yes | `/generate` form |
| read | yes | Library grid + `/clip` detail (player, manifest entry, keys, checksum, labels) |
| edit | **omitted** | not user-accessible because a clip's prompt, seed, model and revision are its provenance; editing them would make the manifest describe a clip that was never generated. "Use these settings" on the detail page opens `/generate` pre-filled to create a new clip instead. |
| delete | yes | detail page, confirm dialog; deletes clip + sidecar and removes its manifest line |
| run | yes | Regenerate (detail), Share link (detail), Age job (`/archive`) |

### Form UX conventions

Generate (create) form:
- Selectors: `model_id` (Select from `/models`), `resolution` (Select, presets of the chosen model), `num_frames` (Select 17/33/49/81/121), `num_inference_steps` (Select 20/30/40/50). `project` is a Combobox of existing projects that also accepts a new name (open-ended).
- Free text: prompt, negative prompt; numbers: seed, guidance scale.
- Default guidance in placeholder / `FormDescription`, no autofill button: model `wan2.2-ti2v-5b`; resolution `480p`; frames 49; steps 30; guidance 5.0; seed blank for random (recorded); project `demo`; prompt placeholder "A red fox trotting through fresh snow at dawn, cinematic".

Archive (run) form: `older_than_days` number (hint: server default `ARCHIVE_AFTER_DAYS`, 30), `as_of` date picker (hint: leave empty for now; set a future date to preview aging), dry run switch default on.

Share dialog: TTL segmented control 15 min / 1 h / 24 h / 7 days, default 1 h.

Settings (edit, opens pre-filled): default project (text), default share TTL (Select), theme. Follows `settings-form.tsx`.

### Self-test (`live_tests/test_wan_archive_e2e.py`, markers `live` and `gpu`)

Runs the real model (`WAN_MODEL`, TI2V-5B on the Vultr A40; the 1.3B model locally for development) at the self-test preset against a B2 test bucket, under a unique project `selftest-<run id>`, in one pass:
1. Generate clip A; age with `as_of = now + ARCHIVE_AFTER_DAYS + 1` days; assert A moved to `video/archive/<project>/<yyyy-mm>/`, recent key gone, manifest resolves A to the archive key.
2. Generate clip B; age with `as_of = now`; assert B stays recent.
3. For A and B: presigned link returns 200 `video/mp4`; downloaded SHA-256 equals the manifest and object metadata.
4. Fail if any clip lacks `ai-generated` object metadata, the MP4 `ai_generated` container tag, or the manifest `ai_generated: true` / `ai_label`.
5. Regenerate A from its manifest; assert the new entry copies prompt, seed, model, revision and settings and sets `regenerated_from`.
6. Audit B2 standards (user agent string, endpoint from `B2_REGION`, `B2_*` names).
Cleanup deletes only keys under the test project's prefixes and its manifest.

Unit tests (no GPU, no B2): fake generator injected through the service constructor and an in-memory object store; cover key layout, manifest append/rewrite/delete, age cutoff boundaries and month bucketing with a fixed clock, label writing and reading on a tiny real MP4, TTL clamping, regenerate settings copy, registry pins (40-hex revision, Apache-2.0, huggingface.co), the `HF_ENDPOINT` guard, the explorer 409 guard, and the `user_agent_extra` value. New scripts: `test:live:gpu`, `gpu:preflight`.

## 5. Doc transforms

- Rewrite: `README.md` (gen regions plus hand sections: Model and license table with pinned revisions; "The repository license does not cover the model weights"; license notes for Diffusers, boto3, imageio-ffmpeg BSD-2-Clause and the bundled ffmpeg LGPL/GPL; the LTX-Video / LTX-2 license-based exclusion; Quickstart for local dev with the 1.3B model; GPU validation section with an empty results table for the GPU validation run: date, GPU, model revision, preset, peak VRAM, generation seconds, age job result, share link opened), `ARCHITECTURE.md`, `AGENTS.md`, `CLAUDE.md`/`GEMINI.md`/copilot instructions (rename only), `PRODUCT.md`, `docs/app-workflows.md`, `docs/SECURITY.md` (share link TTL, no public bucket, explorer guard), `docs/RELIABILITY.md` (single writer, archive copy-verify-delete order), `docs/verification.md` (self-test + preflight), `docs/features/file-browser.md` (titled Bucket explorer, `video/` guard), `docs/features/settings.md`.
- Delete: `docs/features/file-upload.md`, `docs/features/dashboard.md`.
- Keep: `docs/features/metadata-extraction.md`, `docs/design-system.md`, `docs/frontend-conventions.md`, `docs/dev-workflows.md`, `_template.md`.
- Add: `docs/features/clip-generation.md`, `clip-library.md`, `manifest.md`, `archive-age-job.md`, `share-links.md`, `regeneration.md`, `infra/gpu-vm/README.md`.
- Reference architecture: the README links `b2-generative-media-reference-architectures` as the architecture this sample implements, and related samples `flux-b2-generation-output-lifecycle` and `video-dubbing-b2-language-variants`.

### Declared identity: `docs/exec-plans/sample.json`

`docs/exec-plans/sample.json` is the declared identity that `pnpm gen:docs` reads:

```json
{
  "$schema": "../../scripts/gen/sample.schema.json",
  "schema_version": 1,
  "name": "Wan Video Generation Archive",
  "slug": "wan-video-generation-archive",
  "package_scope": "@wan-video-generation-archive",
  "purpose": "Generate short videos with Wan2.2 TI2V-5B on one GPU and keep every clip in Backblaze B2 with its prompt, seed, pinned model revision and license, archived by age and shared through expiring links.",
  "tagline": "Every generated clip stays findable, reproducible and labelled as it ages.",
  "primary_entity": { "schema": "ClipRecord", "singular": "clip", "plural": "clips" },
  "features": [
    { "title": "Clip Generation", "route": "/generate", "doc": "docs/features/clip-generation.md", "summary": "Wan2.2 text-to-video on one GPU, labelled AI-generated", "workflow_heading": "Generate a Clip" },
    { "title": "Clip Library", "route": "/", "doc": "docs/features/clip-library.md", "summary": "browse clips by project and tier with their manifest entries", "workflow_heading": "Find a Clip" },
    { "title": "Prompt-and-Seed Manifest", "route": null, "doc": "docs/features/manifest.md", "summary": "per-project JSONL with prompt, seed, model revision, license and checksum" },
    { "title": "Archive Age Job", "route": "/archive", "doc": "docs/features/archive-age-job.md", "summary": "move older clips to the archive prefix and update manifest keys", "workflow_heading": "Archive Older Clips" },
    { "title": "Share Links", "route": null, "doc": "docs/features/share-links.md", "summary": "expiring presigned links for recent or archived clips" },
    { "title": "Regenerate from Manifest", "route": null, "doc": "docs/features/regeneration.md", "summary": "re-run a clip from its recorded prompt, seed and revision" },
    { "title": "Bucket Explorer", "route": "/files", "doc": "docs/features/file-browser.md", "summary": "browse, preview and download every object in the bucket", "workflow_heading": "Browse the Bucket" },
    { "title": "Metadata Extraction", "route": null, "doc": "docs/features/metadata-extraction.md", "summary": "image dimensions, EXIF, PDF info, checksums in the explorer" },
    { "title": "Settings", "route": "/settings", "doc": "docs/features/settings.md", "summary": "theme, default project and default share link lifetime", "workflow_heading": "Change Preferences" }
  ],
  "b2_surface": [
    { "operation": "put_object", "why": "store a clip, its settings sidecar and the rewritten project manifest" },
    { "operation": "get_object", "why": "read a project manifest or settings sidecar" },
    { "operation": "head_object", "why": "verify an archive copy before removing the recent copy, and the /health probe" },
    { "operation": "copy_object", "why": "move a clip from video/recent/ to video/archive/ keeping its AI-generated metadata" },
    { "operation": "delete_object", "why": "drop the recent copy after a verified move, or delete a clip" },
    { "operation": "list_objects_v2", "why": "list project manifests and back the full-bucket explorer" },
    { "operation": "presigned GET", "why": "expiring share links and explorer downloads without a public bucket" }
  ],
  "b2_key_prefix": "video/",
  "stack": {
    "web": "Next.js 16, React 19, Tailwind v4, shadcn/ui, TanStack Query",
    "api": "FastAPI, Python 3.12+, boto3, Pydantic v2, Diffusers, PyTorch, imageio-ffmpeg",
    "storage": "Backblaze B2 (S3-compatible API)",
    "package_manager": "pnpm workspaces"
  },
  "deployment_targets": [],
  "env_vars": [
    { "name": "B2_APPLICATION_KEY_ID", "required": true, "secret": true, "note": "B2 application key ID (**keyID** in the B2 console)" },
    { "name": "B2_APPLICATION_KEY", "required": true, "secret": true, "note": "B2 application key (**applicationKey**), shown once at creation" },
    { "name": "B2_BUCKET_NAME", "required": true, "secret": false, "note": "bucket unique name (**Bucket Unique Name** in the B2 console)" },
    { "name": "B2_REGION", "required": true, "secret": false, "note": "the region inside the bucket's **Endpoint** (`s3.<region>.backblazeb2.com`); the S3 endpoint is derived from it" },
    { "name": "B2_PUBLIC_URL_BASE", "required": false, "secret": false, "note": "public object base URL, only when the bucket is public; share links never need it" },
    { "name": "WAN_MODEL", "required": false, "secret": false, "note": "`wan2.2-ti2v-5b` (default) or `wan2.1-t2v-1.3b` for local development" },
    { "name": "WAN_DEVICE", "required": false, "secret": false, "note": "`auto` (CUDA, then MPS, then CPU), `cuda`, `mps` or `cpu`" },
    { "name": "WAN_CPU_OFFLOAD", "required": false, "secret": false, "note": "`auto` (on below 40 GB VRAM), `on` or `off`" },
    { "name": "HF_TOKEN", "required": false, "secret": true, "note": "optional; both pinned models are public on huggingface.co" },
    { "name": "HF_HOME", "required": false, "secret": false, "note": "local cache directory for model weights" },
    { "name": "ARCHIVE_AFTER_DAYS", "required": false, "secret": false, "note": "age in days after which the age job archives a clip (default 30)" },
    { "name": "SHARE_LINK_TTL_SECONDS", "required": false, "secret": false, "note": "default share link lifetime (default 3600, max 604800)" },
    { "name": "NEXT_PUBLIC_API_URL", "required": false, "secret": false, "note": "API origin when the web app runs on a different host; Next.js inlines it at build time" }
  ],
  "attribution_token": "b2ai-wan-video-generation-archive",
  "repo": { "org": "backblaze-b2-samples", "name": "wan-video-generation-archive" },
  "screenshots": []
}
```

## 6. Rename table

| From | To |
|---|---|
| `vibe-coding-starter-kit` (kebab: package.json name, workflow names, docs, CORS rule id, localStorage namespace via slug) | `wan-video-generation-archive` |
| `vibe_coding_starter_kit` (snake, pyproject/module names if any) | `wan_video_generation_archive` |
| `Vibe Coding Starter Kit` (Title Case, `APP_NAME`, FastAPI title) | `Wan Video Generation Archive` |
| `@vibe-coding-starter-kit/web`, `@vibe-coding-starter-kit/shared` (and every `--filter` in package.json) | `@wan-video-generation-archive/web`, `@wan-video-generation-archive/shared` |
| `user_agent_extra="b2ai-oss-start"` and the starter kit attribution token / `utm_content` | `b2ai-wan-video-generation-archive` |
| `uploads/` key prefix | `video/` |
| `backblaze-b2-samples/vibe-coding-starter-kit` repo URLs (clone, issues) | `backblaze-b2-samples/wan-video-generation-archive` |
| Image tags / service names (`vibe-coding-starter-kit-api`, `-web`, if present) | `wan-video-generation-archive-api`, `-web` |
| Starter kit screenshots in `docs/images/` | removed (`screenshots: []` until screenshots of this app are taken) |

After the sweep, `grep -ri "vibe-coding\|vibe_coding\|Vibe Coding\|b2ai-oss-start"` returns only the provenance line naming the starter kit in this plan and the README credits.
