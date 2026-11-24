<!-- last_verified: 2026-11-24 -->
# Feature: Clip Library

## Purpose
Find any clip, recent or archived, and see exactly how it was made.

## Used By
- UI: `/` (`ClipLibrary`) and `/clip?project=&id=` (`ClipDetail`)
- API: `GET /clips?project=&tier=&q=`, `GET /projects`, `GET /projects/{project}/clips/{clip_id}`, `DELETE /projects/{project}/clips/{clip_id}`, `GET /files-by-key/preview?key=` (inline player URL)

## Core Functions
- `apps/web/src/components/clips/clip-library.tsx`: filters (project, tier, search) and the card grid with an inline player
- `apps/web/src/components/clips/clip-detail.tsx`: player, full manifest entry, Share, Regenerate, "Use these settings", Delete
- `apps/web/src/lib/clip-links.ts`: `clipHref()`, `generateHrefFromClip()`, `readGenerateDefaults()`
- `services/api/app/service/clips.py`: `list_clips()`, `get()`, `delete()`, `projects()`

## Canonical Files
- Scoped explorer pattern: `apps/web/src/components/clips/clip-library.tsx`

## Inputs
- `project?` (filter), `tier` (`recent | archive | all`), `q?` (case-insensitive match on prompt or clip id)

## Outputs
- `ClipList` (`items: ClipRecord[]`, newest first), `ProjectSummary[]`, one `ClipRecord`
- Delete: `DeleteClipResponse` (`clip_id`, `deleted_keys`); removes the manifest line first, then the MP4 and the sidecar, so a crash midway leaves at worst an orphaned object, never a manifest line pointing at a missing object

## Flow
- The Library reads manifests, not a bucket listing, so every card is a manifest entry and resolves to the clip's current key in either tier
- "Play" asks for an inline presigned URL for the clip's `output_key` and plays it in the card
- The detail page shows every manifest field (seed, model, 40-hex revision, license, device, versions, keys, SHA-256, timestamps, `regenerated_from`)
- Editing a clip is deliberately not offered: prompt, seed, model and revision are its provenance. "Use these settings" opens `/generate` pre-filled to create a new clip instead

## Edge Cases
- No clips -> empty state with a "Generate a clip" action
- Unknown project or clip id -> 404, error state on the detail page
- Invalid project name in a filter -> 400
- Regenerate disabled when the clip's revision is not in the pinned registry

## UX States
- Empty: "No clips here yet"
- Loading: skeleton cards
- Error: inline error state with Retry
- Delete: confirm dialog, then return to the Library

## Verification
- Test files: `services/api/tests/test_clip_generation.py` (list, projects, delete), `services/api/tests/test_clip_routes.py`, `apps/web/src/lib/clip-links.test.ts`, `apps/web/e2e/navigation.spec.ts`
- Focused verify command: `pnpm test:api && pnpm test:web`
- Default pre-PR verify command: `pnpm verify`
- Pass criteria: list/filter/delete cases green; the Generate pre-fill round-trips a clip's settings

## Related Docs
- [manifest.md](manifest.md)
- [share-links.md](share-links.md)
- [file-browser.md](file-browser.md)
