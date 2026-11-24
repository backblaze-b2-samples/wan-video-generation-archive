<!-- last_verified: 2026-11-24 -->
# Reliability

Reliability expectations and practices for this project.

## Health Checks

- `GET /health` verifies B2 connectivity and returns `healthy` or `degraded`
- Health endpoint is always available, even when B2 is down
- The B2 client bounds connection attempts to 5 seconds, socket reads to 30
  seconds, and standard retries to 3 total attempts. Normal tests mock this
  boundary and deny network access; real connectivity is opt-in through
  `RUN_LIVE_B2_TESTS=1 pnpm test:live:b2`.
- `GET /models` reports which model is loaded and on which device.

## Error Handling

- HTTP handlers return structured error responses with appropriate status codes: 400 for values the registry or key layout does not allow, 404 for unknown projects/clips/jobs, 409 for an unpinned regenerate or a protected explorer delete, 502 when a storage call fails
- No unhandled exceptions leak stack traces to clients
- Uncaught exceptions are converted to a typed JSON 500 (`{"detail": "Internal server error"}`, modeled by `app.types.ErrorResponse`) by the catch-all in `timing_middleware`
- **Error responses carry CORS headers.** `CORSMiddleware` is registered LAST in `main.py` so it is the outermost middleware and wraps every response, including uncaught-exception 500s produced by the inner catch-all. Regression-guarded by `tests/test_error_handling.py::test_unhandled_exception_500_carries_cors_headers`.

## Single Writer for Manifests

- B2 has no append, so each manifest change is a read-modify-write of `video/manifests/<project>.jsonl` under a per-project `threading.Lock` in `app/repo/manifest_store.py`.
- That lock is per process. **The API process is the single writer**: run one API process per bucket, and do not run `wan_archive.py` write commands (`generate`, `age`, `regenerate`) against a project while the API is writing to it. Two writers on one project can lose a line (last write wins). A multi-writer deployment needs a conditional write or a database for the manifest.

## Archive Order: Copy, Verify, Record, Delete

- Per clip the age job copies the MP4 server-side (`MetadataDirective=COPY`, single part so the metadata is copied verbatim), heads the copy and checks its size and `sha256` metadata, copies and heads the sidecar, rewrites the manifest line, and only then deletes the recent copies.
- A failure before the manifest rewrite leaves the clip where it was (the job reports the error; a partial archive copy may remain and is overwritten by the next run). A failure after it leaves an extra recent copy, never a missing clip: the manifest always names a key that exists.
- Deleting a clip from the Library uses the same rule: it removes the manifest line first, then the MP4 and the sidecar. A crash midway leaves an orphaned object, never a manifest line naming a missing key.
- Age is computed from `created_at` in the manifest, not `LastModified`, because a copy resets `LastModified`.

## Generation Jobs

- One worker thread runs jobs FIFO, one at a time, so one pipeline is resident on the GPU. Jobs live in memory: a restart loses queued and running jobs but never a stored clip, because objects and the manifest line are written only after encoding succeeds, and a failed write removes what was already written.
- Device fallback: CUDA, then Apple MPS, then CPU; a GPU is never hard-required. `WAN_CPU_OFFLOAD=auto` turns on model CPU offload below 40 GB of VRAM; `pnpm gpu:preflight` records the real peak on the GPU host.
- The model stack is pinned to bounded windows in `services/api/requirements-model.txt`, and every model to a 40-hex revision, so a fresh host resolves the same weights.

## Logging

- Structured JSON logging via Python stdlib
- Every request gets a `request_id` for tracing; job failures are logged with their job id and traceback
- Log levels: ERROR for failures, WARNING for degraded state, INFO for requests

## Observability

- Request timing middleware logs duration for every request
- `/metrics` exposes Prometheus counters: requests, latency, `clips_generated_total`, `clip_generation_errors_total`

## Stateful Counters

- The download counter (`app/repo/counter.py`, `.data/download_count.json` at the repo root), the `/metrics` counters and the job history are in-process and reset on restart.

## Rate Limiting

- Per-IP fixed-window limiter (`app/runtime/ratelimit.py`); `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_WRITE_PER_MINUTE` are the budgets. Rejected requests get `429` with a `Retry-After` header.
- Counters are in-process; a global limit across processes needs a shared store.

## Graceful Degradation

- Listings return an empty list (not an error) when B2 has no objects; a project without a manifest has no clips
- Metadata extraction failures in the explorer return partial metadata with a warning
- The frontend shows skeleton, empty and error states with Retry; the job panel shows queued, running (step N of total) and failed states
- The explorer's full bucket listing is cached, warmed at startup and served stale-while-revalidate (`LIST_CACHE_TTL_SECONDS`, default 300); clip writes and deletes invalidate it. `WARM_LIST_CACHE_ON_STARTUP=false` skips the startup scan

## Deployment

- The GPU host runs both services; the runbook is [infra/gpu-vm/README.md](../infra/gpu-vm/README.md). Promotion of a change requires `b2_connected: true` on `/health`, `pnpm gpu:preflight` and `RUN_LIVE_B2_TESTS=1 pnpm test:live:gpu` green on that host.
- Environment-specific configuration uses environment variables; no environment values are committed to the repository.
