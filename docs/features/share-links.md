<!-- last_verified: 2026-11-24 -->
# Feature: Share Links

## Purpose
Hand anyone a link that plays a clip in the browser, from either tier, without making the bucket public.

## Used By
- UI: "Share link" dialog on `/clip` (`ShareDialog`)
- API: `POST /projects/{project}/clips/{clip_id}/share` with `ShareRequest`
- CLI: `wan_archive.py share --project <p> --clip-id <id> [--ttl N]`

## Core Functions
- `services/api/app/service/share.py`: `ShareService.share()`, `clamp_ttl()`
- `services/api/app/repo/clip_store.py`: `presign_inline_video()`

## Inputs
- `expires_in_seconds?`: defaults to `SHARE_LINK_TTL_SECONDS` (3600), clamped to 60..604800 (the S3 presigned-URL ceiling is 7 days). The UI offers 15 min, 1 h, 24 h and 7 days, pre-selecting the Settings default

## Outputs
- `ShareLink`: `url` (presigned GET with `ResponseContentType=video/mp4` and `Content-Disposition: inline`), `expires_at`, `key`, `tier`
- For a recent clip, the manifest line's `share_expires_at` is raised to the link's expiry (never lowered)

## Flow
- Look up the manifest entry, head its current key (404 if the object is gone), presign it
- Because the manifest always names the current key, a link minted after archiving points into `video/archive/`
- A presigned URL is bound to one key, and archiving moves the clip (copy, then delete the recent key). So minting a link for a recent clip records `share_expires_at`, and the age job holds the clip in recent until that time (reported in `AgeJobResult.held`); a later run moves it. A link for a recent clip therefore never breaks before it expires, unless the user deliberately runs the age job with `include_held` ("Archive held clips anyway"), which moves the clip, clears `share_expires_at` and reports it in `AgeJobResult.released`; those links stop working. The API is reached only through an SSH tunnel, so a stable app-hosted redirect link was not an option: recipients must be able to open the B2 URL directly

## Edge Cases
- TTL below 60 or above 604800 -> clamped, not rejected
- Clip missing from the bucket -> 404
- Link used after expiry, or after its clip was moved with "Archive held clips anyway" -> B2 answers with an error (401 or 403); mint a new one
- Link minted while the age job is copying that clip -> the manifest swap sees the hold, the archive copies are deleted and the clip stays recent
- Clip deleted -> its links stop working (404) even before they expire

## UX States
- While a recent clip is held, its Library card and clip page show a "shared until <time>" badge, the clip page explains the hold under its actions, and the Archive page's project hint counts held clips (`ProjectSummary.held_count`)

## Verification
- Test files: `services/api/tests/test_share_links.py`, `services/api/tests/test_archive_age.py` (share holds), `services/api/tests/test_clip_routes.py`, `apps/web/src/lib/preferences.test.ts`
- Focused verify command: `pnpm test:api`
- Pass criteria: clamping table green; the live self-test downloads each link (200, `video/mp4`) and its SHA-256 equals the manifest

## Related Docs
- [SECURITY.md](../SECURITY.md)
- [settings.md](settings.md)
