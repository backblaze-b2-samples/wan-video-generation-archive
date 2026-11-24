<!-- last_verified: 2026-11-24 -->
# Architecture

## Components

<!-- gen:begin arch-components -->
Generate short videos with Wan2.2 TI2V-5B on one GPU and keep every clip in Backblaze B2 with its prompt, seed, pinned model revision and license, archived by age and shared through expiring links.

- **apps/web/** — Next.js 16, React 19, Tailwind v4, shadcn/ui, TanStack Query
  - Clip Generation (`/generate`) — Wan2.2 text-to-video on one GPU, labelled AI-generated
  - Clip Library (`/`) — browse clips by project and tier with their manifest entries
  - Archive Age Job (`/archive`) — move older clips to the archive prefix and update manifest keys
  - Bucket Explorer (`/files`) — browse, preview and download every object in the bucket
  - Settings (`/settings`) — theme, default project and default share link lifetime
- **services/api/** — FastAPI, Python 3.12+, boto3, Pydantic v2, Diffusers, PyTorch, imageio-ffmpeg
  - REST API for every operation the frontend consumes, exported to `docs/api/openapi.json`
  - Backblaze B2 (S3-compatible API) access isolated in the `repo/` layer
  - Prompt-and-Seed Manifest — per-project JSONL with prompt, seed, model revision, license and checksum
  - Share Links — expiring presigned links for recent or archived clips
  - Regenerate from Manifest — re-run a clip from its recorded prompt, seed and revision
  - Metadata Extraction — image dimensions, EXIF, PDF info, checksums in the explorer
  - Structured JSON logging with request tracing, plus `/health` and Prometheus `/metrics`
- **packages/shared/** — TypeScript types generated from the API contract by `pnpm gen:api`, consumed by `apps/web/` as a workspace dependency (pnpm workspaces)
<!-- gen:end arch-components -->

## Backend Layering

The API follows a strict layered architecture:

```
types/     Pydantic models — no logic, no imports from other layers
  |
config/    Settings, pinned model registry, key layout — depends only on types
  |
repo/      Adapters: boto3 B2 client, clip store, manifest store, Wan pipeline,
           MP4 encoder — no business logic
  |
service/   Business logic — calls repo, returns types
  |
runtime/   FastAPI routes — calls service, never repo directly
```

### Layering Rules

1. Dependencies flow downward only: `types` -> `config` -> `repo` -> `service` -> `runtime`
2. No backward imports (e.g., service must not import from runtime)
3. `boto3` only allowed in `repo/` layer; `torch` and `diffusers` only inside
   `repo/wan_pipeline.py`, imported lazily so the API and tests run without them
4. All boundary data uses Pydantic models (no raw dicts across layers)
5. Authored Python files under `services/api/app/` stay under 300 lines

### Directory Structure

<!-- gen:begin arch-directory -->
```
services/api/
  main.py                  App entrypoint, middleware, router registration
  app/
    types/                 Pydantic models, and the response-model base
    config/                Settings loaded from environment
    repo/                  B2 S3 client (data access layer)
    service/               Business logic
    runtime/               FastAPI route handlers
  scripts/                 Operational scripts (OpenAPI export, bucket CORS)
  tests/                   pytest tests (structural + integration)
```
<!-- gen:end arch-directory -->

## Boundary Invariants

- **No external SDK leakage**: `boto3` is only imported in `app/repo/`; the ML stack only inside `app/repo/wan_pipeline.py`, inside methods. `tests/test_model_registry.py::test_api_never_imports_torch` asserts importing the app pulls in neither torch nor diffusers.
- **No raw dicts at boundaries**: data crossing layers uses Pydantic models, or the frozen dataclasses in `app/types/generation.py` between the clip service and a generator.
- **One wiring point**: `app/service/container.py` builds the repo adapters and services once per process (`get_services()`); tests swap the whole set with `set_services(build_services(fake_client, ...))`.
- **No cross-layer mutable state**: configuration is read-only after init. Module-local state is guarded by locks: the listing cache and B2 connectivity cache in `repo/`, the per-project manifest locks in `repo/manifest_store.py`, the job table in `service/jobs.py`, the rate-limit and metrics state in `runtime/`.
- **Background threads**: the listing cache's refresh thread, and one generation worker thread (`service/jobs.py`) that runs jobs FIFO, one at a time, so a single pipeline sits on the GPU and the API process is the single writer of every manifest.
- **Validated inputs**: HTTP inputs are validated by FastAPI/Pydantic; project names match `^[a-z0-9][a-z0-9-]{0,62}$`; model, resolution and frame count must be in the registry; explorer keys reject path traversal, and deletes under `video/recent/`, `video/archive/` and `video/manifests/` are refused (409).

## Deployment

- **Local dev**: `pnpm dev` runs both services via `concurrently` (web `localhost:3000`, API `localhost:8000`). With the model stack installed and `WAN_MODEL=wan2.1-t2v-1.3b`, generation runs on a smaller CUDA GPU or, best effort, Apple MPS.
- **GPU host**: the same two processes on one CUDA machine (validated on a Vultr A40), reached through an SSH tunnel. Runbook: [infra/gpu-vm/README.md](infra/gpu-vm/README.md).
- No serverless target: a torch GPU worker cannot run on Vercel or Railway, so `deployment_targets` is empty and the starter kit's Vercel and Railway configs were removed.

External provisioning and deployment remain explicit user-approved actions.

## Data Stores

<!-- gen:begin arch-data-stores -->
- **Backblaze B2 (S3-compatible API)** — the only data store; there is no application database
  - Every object this app writes lives under the `video/` key prefix of one bucket
  - Listing, per-key metadata and presigned URLs all come from the S3 surface below
  - The primary entity is `ClipRecord`; one clip is one object
<!-- gen:end arch-data-stores -->

## External Services

<!-- gen:begin arch-external-services -->
- **Backblaze B2 (S3-compatible API)** — reached only through `services/api/app/repo/`, using:
  - `put_object` — store a clip, its settings sidecar and the rewritten project manifest
  - `get_object` — read a project manifest or settings sidecar
  - `head_object` — verify an archive copy before removing the recent copy, and the /health probe
  - `copy_object` — move a clip from video/recent/ to video/archive/ keeping its AI-generated metadata
  - `delete_object` — drop the recent copy after a verified move, or delete a clip
  - `list_objects_v2` — list project manifests and back the full-bucket explorer
  - `presigned GET` — expiring share links and explorer downloads without a public bucket
<!-- gen:end arch-external-services -->

## Trust Boundaries

See [docs/SECURITY.md](docs/SECURITY.md) for full security documentation.

- **Frontend -> API**: CORS-restricted to configured origins. `CORSMiddleware` is registered LAST in `main.py` (outermost) so it wraps every response, including uncaught-exception 500s. See [docs/RELIABILITY.md](docs/RELIABILITY.md#error-handling). A per-IP rate-limit middleware sits inner to CORS; see [docs/SECURITY.md](docs/SECURITY.md#rate-limiting).
- **API -> B2**: application key, signature v4, user agent `b2ai-wan-video-generation-archive`.
- **API -> huggingface.co**: model weights only, at pinned revisions; any other `HF_ENDPOINT` is refused.
- **Anyone with a share link -> B2**: a presigned GET for one key, inline `video/mp4`, 60 s to 7 days. The bucket stays private.

## Data Flows

- **Generate**: Browser -> `POST /clips` (validated against the registry, 202 + job) -> worker thread: Wan pipeline -> frames -> MP4 with AI-generated tags -> `put_object` MP4, `put_object` sidecar, manifest read-modify-write. Browser polls `GET /jobs/{job_id}`.
- **Find**: Browser -> `GET /clips` / `GET /projects` -> service reads `video/manifests/*.jsonl` -> `ClipRecord[]`. The player asks `GET /files-by-key/preview?key=<output_key>` for an inline presigned URL.
- **Age**: `POST /projects/{project}/archive` (or the CLI) -> for each due clip: `copy_object` MP4 -> `head_object` verify size + `sha256` -> `copy_object` sidecar -> manifest rewrite -> `delete_object` recent copies.
- **Share**: `POST .../share` -> manifest lookup -> `head_object` -> presigned GET for the current key.
- **Regenerate**: `POST .../regenerate` -> registry pin check (409 if unpinned) -> same generate flow with `regenerated_from`.
- **Explorer**: `/files` lists, previews and downloads any object through the kit's file routes.

## Observability

- Structured JSON logging on all requests with `request_id`; generation, archive and job failures are logged with their clip or job id
- Request timing middleware (also the catch-all that converts uncaught exceptions to a typed JSON 500)
- `/metrics` (Prometheus): request counts and latency, `clips_generated_total`, `clip_generation_errors_total`
- `/health` (B2 connectivity check); `GET /models` reports which model is loaded and on which device

## API Contract

<!-- gen:begin arch-api-contract -->
- Checked-in OpenAPI artifact: `docs/api/openapi.json`
- Export / check: `pnpm contract:export` / `pnpm contract:check`
- Generate the client seam from it: `pnpm gen:api` (drift gate: `pnpm gen:check`)
- FastAPI freshness test: `services/api/tests/test_openapi_contract.py`
- Frontend route drift test: `apps/web/src/lib/api-contract.test.ts`

The FastAPI routers and Pydantic models are the single source of truth. The
frontend's `API_CLIENT_ROUTES` registry, the `qk` query-key factory and the
shared TypeScript types are **generated** from the exported artifact by
`pnpm gen:api`, so the client cannot drift from the backend — there is no
hand-written copy left to disagree. The two contract tests are kept as a
belt-and-braces check that the generated files and the committed artifact are
still in step.

| Route | Returns | Generated client route |
| --- | --- | --- |
| `DELETE /files-by-key` | `DeleteFileResponse` | `fileByKeyDelete` |
| `DELETE /files/{key}` | `DeleteFileResponse` | `legacyFileDelete` |
| `DELETE /projects/{project}/clips/{clip_id}` | `DeleteClipResponse` | `deleteClip` |
| `GET /clips` | `ClipList` | `clips` |
| `GET /files` | `FileMetadata[]` | `files` |
| `GET /files-by-key/detail` | `FileMetadataDetail` | `fileByKeyDetail` |
| `GET /files-by-key/download` | `FileUrlResponse` | `fileByKeyDownload` |
| `GET /files-by-key/metadata` | `FileMetadata` | `fileByKeyMetadata` |
| `GET /files-by-key/preview` | `FileUrlResponse` | `fileByKeyPreview` |
| `GET /files/{key}` | `FileMetadata` | `legacyFileMetadata` |
| `GET /files/{key}/download` | `FileUrlResponse` | `legacyFileDownload` |
| `GET /files/{key}/preview` | `FileUrlResponse` | `legacyFilePreview` |
| `GET /files/stats` | `UploadStats` | `fileStats` |
| `GET /health` | `HealthStatus` | `health` |
| `GET /jobs` | `GenerationJob[]` | `jobs` |
| `GET /jobs/{job_id}` | `GenerationJob` | `job` |
| `GET /metrics` | — | _server-only_ |
| `GET /models` | `ModelInfo[]` | `models` |
| `GET /projects` | `ProjectSummary[]` | `projects` |
| `GET /projects/{project}/clips/{clip_id}` | `ClipRecord` | `clip` |
| `POST /clips` | — | `generateClip` |
| `POST /projects/{project}/archive` | `AgeJobResult` | `ageProject` |
| `POST /projects/{project}/clips/{clip_id}/regenerate` | — | `regenerateClip` |
| `POST /projects/{project}/clips/{clip_id}/share` | `ShareLink` | `shareClip` |
<!-- gen:end arch-api-contract -->

## Canonical Files

<!-- gen:begin arch-canonical-files -->
Hand-written — this is the file to edit:

- Layered API handler: `services/api/app/runtime/`
- Service orchestration: `services/api/app/service/`
- B2 data access (repo layer): `services/api/app/repo/b2_client.py`
- Pydantic models: `services/api/app/types/` (`base.py` carries the response-model config)
- Config (pydantic-settings): `services/api/app/config/settings.py`
- Structural tests: `services/api/tests/test_structure.py`
- OpenAPI exporter: `services/api/scripts/export_openapi.py`
- Frontend API client — error policy, transport, fallback: `apps/web/src/lib/api-client.ts`
- Frontend data layer — caching, invalidation, polling: `apps/web/src/lib/queries.ts`
- Shared type barrel: `packages/shared/src/types.ts`
- Generator policy: `scripts/gen/api-gen.config.json`
- Sample manifest behind the generated docs: `docs/exec-plans/sample.json`

Generated — **never hand-edit**; change the source and re-run the command:

- `docs/api/openapi.json` — `pnpm contract:export` (source: the routers and models)
- `packages/shared/src/generated/api-types.ts` — `pnpm gen:api`
- `apps/web/src/lib/generated/api-routes.ts` — `pnpm gen:api`
- `apps/web/src/lib/generated/query-keys.ts` — `pnpm gen:api`
- The marker-delimited regions of this file, `AGENTS.md`, `README.md` and the 0 `infra/` runbooks — `pnpm gen:docs`
<!-- gen:end arch-canonical-files -->

## Core Features

<!-- gen:begin arch-core-features -->
- [Clip Generation](docs/features/clip-generation.md) — Wan2.2 text-to-video on one GPU, labelled AI-generated
- [Clip Library](docs/features/clip-library.md) — browse clips by project and tier with their manifest entries
- [Prompt-and-Seed Manifest](docs/features/manifest.md) — per-project JSONL with prompt, seed, model revision, license and checksum
- [Archive Age Job](docs/features/archive-age-job.md) — move older clips to the archive prefix and update manifest keys
- [Share Links](docs/features/share-links.md) — expiring presigned links for recent or archived clips
- [Regenerate from Manifest](docs/features/regeneration.md) — re-run a clip from its recorded prompt, seed and revision
- [Bucket Explorer](docs/features/file-browser.md) — browse, preview and download every object in the bucket
- [Metadata Extraction](docs/features/metadata-extraction.md) — image dimensions, EXIF, PDF info, checksums in the explorer
- [Settings](docs/features/settings.md) — theme, default project and default share link lifetime
<!-- gen:end arch-core-features -->

## References

<!-- gen:begin arch-references -->
- [docs/SECURITY.md](docs/SECURITY.md) — security principles and implementation
- [docs/RELIABILITY.md](docs/RELIABILITY.md) — reliability expectations
- [AGENTS.md](AGENTS.md) — architectural invariants and agent instructions
<!-- gen:end arch-references -->
