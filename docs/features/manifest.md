<!-- last_verified: 2026-11-24 -->
# Feature: Prompt-and-Seed Manifest

## Purpose
Keep one append-style record per project that explains and can reproduce every clip: prompt, seed, model, pinned revision, license, checksum and current key.

## Used By
- Every clip feature: generation appends, the age job rewrites keys, delete removes lines, the Library and regenerate read it
- Storage: `video/manifests/<project>.jsonl` in B2, one `ClipRecord` JSON object per line

## Core Functions
- `services/api/app/repo/manifest_store.py`: `ManifestStore.read()`, `update()`, `append()`, `replace()`, `remove()`, `list_projects()`
- `services/api/app/config/layout.py`: key layout and name rules
- `services/api/app/types/clips.py`: `ClipRecord`

## Canonical Files
- Read-modify-write under a lock: `services/api/app/repo/manifest_store.py`

## Inputs
- `ClipRecord` fields: `schema_version`, `clip_id`, `project`, `prompt`, `negative_prompt`, `seed`, `model`, `model_revision`, `model_license`, `diffusers_version`, `torch_version`, `device`, `width`, `height`, `num_frames`, `fps`, `num_inference_steps`, `guidance_scale`, `output_key`, `settings_key`, `tier`, `sha256`, `size_bytes`, `created_at`, `archived_at`, `ai_generated` (always true), `ai_label` (`AI-generated`), `generation_seconds`, `regenerated_from`, `share_expires_at` (latest expiry of a share link minted while the clip was recent; the age job holds the clip until then)

## Outputs
- The JSONL object (`application/x-ndjson`); deleted when its last line is removed
- A settings sidecar next to each MP4 holds the same record minus the keys, tier and `archived_at`, so it stays correct after a move

## Flow
- B2 has no append, so each change reads the whole file, edits the list and writes it back, under a per-project `threading.Lock`
- The API process is the single writer. The CLI writes too, so do not run CLI writes against a project while the API is writing it (see [RELIABILITY.md](../RELIABILITY.md))
- `clip_id` is `<YYYYMMDDTHHMMSSZ>-<8 hex>`; `project` matches `^[a-z0-9][a-z0-9-]{0,62}$`

## Edge Cases
- Missing manifest -> project has no clips (404 for its clips)
- Two writers on one project -> last write wins (documented limit, not handled)

## Verification
- Test files: `services/api/tests/test_clip_generation.py`, `services/api/tests/test_archive_age.py`, `services/api/tests/test_key_layout.py`
- Focused verify command: `pnpm test:api`
- Pass criteria: append, rewrite and delete keep the file consistent; the empty manifest is removed

## Related Docs
- [clip-generation.md](clip-generation.md)
- [archive-age-job.md](archive-age-job.md)
