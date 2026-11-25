<!-- last_verified: 2026-11-24 -->
# Security

Security principles and implementation for the Wan Video Generation Archive sample.

## Trust Boundaries

- **Frontend -> API**: CORS-restricted to configured origins, scoped to `GET/POST/DELETE/OPTIONS`. `allow_credentials` is `False` (no cookie/session auth); enable it only alongside real auth and a tightened origin allowlist.
- **API -> B2**: authenticated via `B2_APPLICATION_KEY_ID` + `B2_APPLICATION_KEY`, signature v4, user agent `b2ai-wan-video-generation-archive`.
- **API -> huggingface.co**: model weights download only from `https://huggingface.co` at the pinned 40-hex revisions in `app/config/models.py`. If `HF_ENDPOINT` names anything else, `check_hf_endpoint()` refuses to load. `HF_TOKEN` is optional (both models are public) and is a secret when set.
- **Browser -> B2**: presigned GETs only: explorer downloads (10 min, attachment), previews (10 min, inline) and share links (below). The browser never writes to B2; clips enter the bucket only through the model.

## Share Links

- A share link is a presigned GET for exactly one key (the clip's current key), signed with `ResponseContentType=video/mp4` and `Content-Disposition: inline`. The age job does not move a recent clip while a link for it is live (`share_expires_at`), so a link is not broken early by archiving.
- Lifetime defaults to `SHARE_LINK_TTL_SECONDS` (3600) and is clamped to 60..604800 seconds (7 days is the S3 presigned-URL ceiling). A link cannot be revoked early except by rotating the application key, so prefer the shortest lifetime that works.
- **No public bucket.** Nothing requires `B2_PUBLIC_URL_BASE`; keep the bucket private. Anyone holding a link can play that one clip until it expires, nothing else.

## Authentication & Multi-Tenancy

- **No auth by design.** Every route (`/clips`, `/projects`, `/jobs`, `/models`, `/files`, `/files-by-key`) is unauthenticated and bucket-wide: any client that reaches the API can queue GPU work, list, share, archive and delete clips, and browse the bucket. That is acceptable for a single-operator tool reached over an SSH tunnel; **never expose the API port publicly** (see [infra/gpu-vm/README.md](../infra/gpu-vm/README.md)).
- **Adding auth to a clone does not close this automatically.** You must both require auth on every route and scope projects and listings to the caller, or one signed-in user can read and delete another's clips. See the notes in `runtime/files.py` and `runtime/clips.py`.

## Explorer Delete Guard

- The bucket explorer refuses (`409`) to delete keys under `video/recent/`, `video/archive/` and `video/manifests/`, because removing them would leave a manifest line pointing at nothing. Clips are deleted from the Library, which removes the objects and the manifest line together. Guard: `FileProtectedError` in `app/service/files.py`.

## Input Validation

- Project names must match `^[a-z0-9][a-z0-9-]{0,62}$`, so a project can never inject a path segment into a key; clip ids are minted by the API.
- Model id, resolution and frame count must be in the pinned registry; steps 1..100, guidance 0..20, prompt up to 2000 characters.
- Regenerate refuses (409) a manifest entry whose model or revision is not pinned.

## Rate Limiting

- Per-IP fixed-window limiter (`app/runtime/ratelimit.py`), configurable via `RATE_LIMIT_PER_MINUTE` (reads) and `RATE_LIMIT_WRITE_PER_MINUTE` (every POST and DELETE, including generation requests, plus downloads and previews). Guards against DoS and Backblaze transaction/egress cost amplification on the unauthenticated endpoints.
- In-process, per replica. Horizontal scaling needs a shared store (e.g. Redis); see [RELIABILITY.md](RELIABILITY.md).

## File Key Validation

- Empty keys rejected
- Path traversal patterns rejected (`../`, `%2e%2e`, backslashes, null bytes)
- Optional prefix confinement: set `ALLOWED_KEY_PREFIX` (e.g. `video/`) to restrict the explorer's key-addressed reads and deletes when the bucket is shared with other workloads. Empty by default.

## Download Safety

- Explorer downloads force `Content-Disposition: attachment`. Previews and share links are `inline`; share links only ever point at clips this app wrote (`video/mp4`).

## Response Hardening

- Baseline headers on every API response: `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`
- Interactive API docs (`/docs`, `/redoc`, `/openapi.json`) are on by default but can be disabled with `ENABLE_DOCS=false` to hide the API surface

## CI Permissions

- `.github/workflows/ci.yml` sets `permissions: contents: read` at the workflow level, so `GITHUB_TOKEN` is read-only in every job. Without an explicit block the token inherits the repository default, which can be read/write.
- Widen per job, never at the top level: a job that must write gets its own `permissions` block scoped to just that need.

## Secrets Management

- All secrets loaded via environment variables (pydantic-settings)
- Never committed to source control
- `.env.example` documents required variables without values

## Dependency and Secret Detection

- [`.github/dependabot.yml`](../.github/dependabot.yml) opens weekly update
  PRs for the root pnpm workspace and `services/api` Python dependencies. Review
  each dependency and lockfile change before merging. The model stack in
  `services/api/requirements-model.txt` is pinned to bounded windows; widen a
  bound only after re-running the GPU gates.
- [`.pre-commit-config.yaml`](../.pre-commit-config.yaml) runs a pinned
  `detect-secrets` hook against staged changes. The generated pnpm lockfile is
  excluded because its integrity hashes are not credentials.
- GitHub secret scanning and push protection are provider-level settings. A
  repository or organization administrator should enable them when available;
  do not represent them as enabled until an administrator confirms them.

## Deployment Configuration

There is no hosted deployment target. On the GPU host, configuration lives in
the repo-root `.env` (never committed); `B2_APPLICATION_KEY_ID`,
`B2_APPLICATION_KEY` and `HF_TOKEN` are secrets. `NEXT_PUBLIC_API_URL` is public
build-time configuration and must never contain a credential. Use a dedicated
bucket and an application key scoped to it. The host runbook is
[infra/gpu-vm/README.md](../infra/gpu-vm/README.md).

## Agent Security Rules

- Never commit `.env`, credentials, or API keys
- Never print them either: the canonical rule lives in
  [AGENTS.md §12 — Secret Handling](../AGENTS.md#12-secret-handling) (agents
  read AGENTS.md first); don't restate it here, it only drifts. The link is
  anchored and `pnpm check:agent-docs` verifies that it still resolves
- The user request and trusted repository instructions are authoritative; see
  [AGENTS.md — Instruction Authority](../AGENTS.md#instruction-authority).
- Never weaken validation without explicit instruction
- Never bypass CORS, auth, or input sanitization
- Always validate at system boundaries
