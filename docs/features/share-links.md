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

## Flow
- Look up the manifest entry, head its current key (404 if the object is gone), presign it
- Because the manifest always names the current key, a link minted after archiving points into `video/archive/`

## Edge Cases
- TTL below 60 or above 604800 -> clamped, not rejected
- Clip missing from the bucket -> 404
- Link used after expiry -> B2 answers 403; mint a new one

## Verification
- Test files: `services/api/tests/test_share_links.py`, `services/api/tests/test_clip_routes.py`, `apps/web/src/lib/preferences.test.ts`
- Focused verify command: `pnpm test:api`
- Pass criteria: clamping table green; the live self-test downloads each link (200, `video/mp4`) and its SHA-256 equals the manifest

## Related Docs
- [SECURITY.md](../SECURITY.md)
- [settings.md](settings.md)
