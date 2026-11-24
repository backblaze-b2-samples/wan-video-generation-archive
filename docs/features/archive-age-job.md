<!-- last_verified: 2026-11-24 -->
# Feature: Archive Age Job

## Purpose
Move clips past a configurable age out of the working prefix into a dated archive prefix, without ever losing track of where a clip is.

## Used By
- UI: `/archive` (`ArchiveForm`)
- API: `POST /projects/{project}/archive` with `AgeJobRequest`
- CLI / cron: `python services/api/scripts/wan_archive.py age --project <p> [--older-than-days N] [--as-of ISO] [--dry-run]`

## Core Functions
- `services/api/app/service/archive.py`: `ArchiveService.age()`, `_move()`
- `services/api/app/repo/clip_store.py`: `copy()` (managed copy, `MetadataDirective=COPY`, single part), `head()`, `delete()`

## Canonical Files
- Copy-verify-delete order: `services/api/app/service/archive.py`

## Inputs
- `older_than_days?` (default `ARCHIVE_AFTER_DAYS`, 30), `as_of?` (clock override, default now), `dry_run` (API default false; the UI defaults it on)

## Outputs
- `AgeJobResult`: `project`, `as_of`, `cutoff` (`as_of - older_than_days`), `moved: ArchiveMove[]` (`clip_id`, `from_key`, `to_key`, `created_at`), `kept_count` (recent clips not yet due; already-archived clips are not counted), `dry_run`
- Moved clips live at `video/archive/<project>/<YYYY-MM>/<clip_id>.mp4` (+ `.json`), the month taken from `created_at`

## Flow
- A clip is due when `tier == "recent"` and `created_at <= cutoff` (age measured from the manifest, because a copy resets `LastModified`)
- Per clip: copy MP4 -> head it and check size and `sha256` metadata -> copy sidecar -> head it -> rewrite the manifest line (`tier`, keys, `archived_at`) -> delete the recent MP4 and sidecar
- Dry run reports the same `moved` list and writes nothing

## Edge Cases
- Exactly at the cutoff -> moves; one second younger -> stays
- Archive copy fails verification -> error, recent copy and manifest untouched
- Crash after the manifest rewrite, before the delete -> a leftover recent copy; the manifest already points at the archive
- Already archived clips -> skipped
- Project without a manifest -> 404

## UX States
- Project select, days, as-of date picker, dry-run switch (on by default)
- Result card listing each move `from -> to`

## Verification
- Test files: `services/api/tests/test_archive_age.py`, `services/api/tests/test_clip_routes.py`, `services/api/tests/test_cli.py`
- Required cases: cutoff boundary, month bucketing from `created_at`, dry run, default days with an injected clock, idempotence, failed verification keeps the recent copy, metadata directive is `COPY`
- Focused verify command: `pnpm test:api`
- Pass criteria: all green; the live self-test archives clip A with `as_of = now + ARCHIVE_AFTER_DAYS + 1` days

## Related Docs
- [manifest.md](manifest.md)
- [RELIABILITY.md](../RELIABILITY.md)
