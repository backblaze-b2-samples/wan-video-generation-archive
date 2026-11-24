<!-- last_verified: 2026-11-24 -->
# Feature: Regenerate from Manifest

## Purpose
Prove a clip is reproducible: re-run it from its manifest entry's prompt, seed, model and pinned revision.

## Used By
- UI: "Regenerate" on `/clip`
- API: `POST /projects/{project}/clips/{clip_id}/regenerate` (202, `GenerationJob` with `kind: regenerate`)
- CLI: `wan_archive.py regenerate --project <p> --clip-id <id>`

## Core Functions
- `services/api/app/service/clips.py`: `prepare_regenerate()`, then the same `run()` as generation
- `services/api/app/config/models.py`: `is_pinned()`

## Inputs
- The source `ClipRecord`: prompt, negative prompt, seed, model, model revision, width, height, frames, steps, guidance

## Outputs
- A new clip in the same project's recent tier with `regenerated_from` set to the source `clip_id`

## Flow
- Refuse with 409 when the entry's model id or revision is not exactly in the pinned registry (the weights could differ)
- Queue the same `GenerationSpec` the source used; the CPU-seeded generator gives the same initial noise for that seed on any device

## Edge Cases
- Revision bumped in the registry since the clip was made -> 409; the old clip stays valid as a record
- Different GPU or library version -> the output can differ slightly in pixels; the manifest records `device`, `diffusers_version` and `torch_version` so that is visible

## Verification
- Test files: `services/api/tests/test_clip_generation.py` (settings copy, 409), `services/api/tests/test_clip_routes.py`
- Focused verify command: `pnpm test:api`
- Pass criteria: the new entry copies prompt, seed, model, revision and settings and sets `regenerated_from`

## Related Docs
- [manifest.md](manifest.md)
- [clip-generation.md](clip-generation.md)
