<!-- last_verified: 2026-11-24 -->
# Feature: Archive Age Job

## Purpose
Move clips past a configurable age out of the working prefix into a dated archive prefix, without ever losing track of where a clip is.

## Used By
- UI: `/archive` (`ArchiveForm`)
- API: `POST /projects/{project}/archive` with `AgeJobRequest`
- CLI / cron: `python services/api/scripts/wan_archive.py age --project <p> [--older-than-days N] [--as-of ISO] [--dry-run] [--include-held]`

## Core Functions
- `services/api/app/service/archive.py`: `ArchiveService.age()`, `_move()`
- `services/api/app/repo/clip_store.py`: `copy()` (managed copy, `MetadataDirective=COPY`, single part), `head()`, `delete()`

## Canonical Files
- Copy-verify-delete order: `services/api/app/service/archive.py`

## Inputs
- `older_than_days?` (default `ARCHIVE_AFTER_DAYS`, 30), `as_of?` (clock override, default now), `dry_run` (API default false; the UI defaults it on), `include_held` (default false: also move clips held by a live share link; their links stop working)

## Outputs
- `AgeJobResult`: `project`, `as_of`, `cutoff` (`as_of - older_than_days`), `moved: ArchiveMove[]` (`clip_id`, `from_key`, `to_key`, `created_at`), `kept_count` (recent clips left in recent, including held ones; already-archived clips are not counted), `held: ArchiveHold[]` (`clip_id`, `share_expires_at`: old enough, but a share link for the recent key is still live), `released: ArchiveHold[]` (with `include_held`: clips moved despite a live link, whose links now fail), `dry_run`
- Moved clips live at `video/archive/<project>/<YYYY-MM>/<clip_id>.mp4` (+ `.json`), the month taken from `created_at`

## Flow
- A clip is due when `tier == "recent"` and `created_at <= cutoff` (age measured from the manifest, because a copy resets `LastModified`)
- A due clip whose `share_expires_at` is after the wall clock is held instead (a presigned share link is bound to the recent key). `as_of` does not release a hold: links expire in real time. The manifest swap re-checks the hold under the manifest lock, so a link minted during the copy cancels that move
- `include_held` is the deliberate way through: held clips move like any due clip, the manifest swap skips the hold check and clears `share_expires_at`, and they are listed in `released` instead of `held`
- Per clip: copy MP4 -> head it and check size and `sha256` metadata -> copy sidecar -> head it -> rewrite the manifest line (`tier`, keys, `archived_at`) -> delete the recent MP4 and sidecar
- Dry run reports the same `moved` list and writes nothing

## Edge Cases
- Exactly at the cutoff -> moves; one second younger -> stays
- Archive copy fails verification -> error, recent copy and manifest untouched
- Crash after the manifest rewrite, before the delete -> a leftover recent copy; the manifest already points at the archive
- Already archived clips -> skipped
- Live share link on a due clip -> held in recent, listed in `held`; moved by the first run after the link expires, or now with `include_held` (listed in `released`, links stop working)
- Project without a manifest -> 404

## UX States
- Project select (preselects the project with the newest clip; shows its recent, held-by-a-live-link and archived counts, updated from the result as soon as a real run finishes), days, as-of date picker, dry-run switch (on by default), "Archive held clips anyway (live links stop working)" switch (off by default; when on, its hint turns red and says every outstanding link for a moved clip stops working)
- `/archive?project=<p>&days=<n>&include_held=1` pre-fills the project, days and the held switch; the clip page's "Archive..." action links here with the clip's age in whole days, so the dry run includes it, and sets `include_held=1` when the clip is held
- The days hint says that empty means 30 days, that a clip made today therefore stays in Recent, and that 0 includes every recent clip now
- Days that are not a whole number of 0 or more show an inline message and disable Preview
- No projects yet: an empty state explains the age job and links to Generate
- Result card listing each move `from -> to`; when nothing moved because the clips are too young, it says so and points at Older than = 0 or a later As of; held clips are listed with their link expiry and a pointer to the held switch; clips moved despite a live link are listed in red as `released`

## Verification
- Test files: `services/api/tests/test_archive_age.py`, `services/api/tests/test_clip_routes.py`, `services/api/tests/test_cli.py`
- Required cases: cutoff boundary, month bucketing from `created_at`, dry run, default days with an injected clock, idempotence, failed verification keeps the recent copy, metadata directive is `COPY`, a live share link holds the clip (also under a future `as_of`), a link minted mid-copy cancels the move, `include_held` moves a held clip and clears its hold, `ProjectSummary.held_count` counts live holds
- Focused verify command: `pnpm test:api`
- Pass criteria: all green; the live self-test archives clip A with `as_of = now + ARCHIVE_AFTER_DAYS + 1` days

## Related Docs
- [manifest.md](manifest.md)
- [RELIABILITY.md](../RELIABILITY.md)
