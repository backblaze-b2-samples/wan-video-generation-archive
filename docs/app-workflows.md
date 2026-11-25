<!-- last_verified: 2026-11-24 -->
# App Workflows

User journeys inside the application.

## Generate a Clip

- User opens `/generate` (or arrives from a clip's "Use these settings", which pre-fills every field from its manifest entry)
- Enters a prompt; the placeholder suggests "A red fox trotting through fresh snow at dawn, cinematic". Optional negative prompt
- Picks or types a project (an input with suggestions from existing projects; new names are accepted). It starts at the Settings default, `demo` unless changed
- Chooses model, resolution, frames and steps from selectors; seed and guidance are free fields whose defaults (random seed, 5.0) are shown as placeholders and descriptions
- Submits: the API validates against the pinned registry and answers with a queued job. The side panel polls it, showing step N of total and "Waiting for the GPU" while another job runs
- First run on a fresh host: the job sits at step 0 while the pinned weights download from huggingface.co
- On success: the page opens the new clip on `/clip` by itself ("Open clip" stays on the job card). On failure: the error is shown on the job, and nothing was written to B2
- See: [Clip Generation](features/clip-generation.md)

## Find a Clip

- User opens `/` (the Library)
- Filters by project and tier (recent, archive, all) and searches the prompt or clip id (the current cards stay visible with a "Searching..." indicator while results load); cards are newest first, and a clip held in Recent by a live share link shows "shared until <time>"
- "Play" on a card plays the clip inline; the prompt opens the detail page
- The detail page shows the player, both labels (tier, AI-generated) and the full manifest entry: seed, model, 40-hex revision, license, size, steps, guidance, device, library versions, keys, SHA-256, timestamps, and `regenerated_from`
- From there: **Share link** (choose 15 min, 1 h, 24 h or 7 days, copy the link), **Regenerate** (queues a new clip from the same prompt, seed and revision; disabled if the revision is no longer pinned), **Use these settings** (opens Generate pre-filled), **Archive...** (recent clips only: opens `/archive` with the project and the clip's age pre-filled; for a clip held by a live share link the page explains the hold and the link turns on "Archive held clips anyway"), **Delete** (confirm dialog; removes the MP4, sidecar and manifest line, then returns to the Library)
- Editing a clip is intentionally not offered: its settings are its provenance
- See: [Clip Library](features/clip-library.md)

## Archive Older Clips

- User opens `/archive`
- Picks a project (the one with the newest clip is preselected; it shows how many clips are recent, held by a live share link, and archived), optionally sets "Older than (days)" (empty means the server default, 30) and "As of" (empty means now; a future date previews aging)
- Dry run is on by default: "Preview" lists every clip that would move, from its recent key to its archive key, and how many stay. If nothing is old enough it says so and suggests Older than = 0; clips held by a live share link are listed with the link's expiry. "Archive held clips anyway (live links stop working)" moves them too, after a warning that their outstanding links stop working
- Turning dry run off and running moves them: each is copied, verified by checksum, recorded in the manifest, then removed from the recent tier. The Library and explorer refresh
- The same job runs headless with `wan_archive.py age`, for a cron schedule on the GPU host
- See: [Archive Age Job](features/archive-age-job.md)

## Browse the Bucket

- User opens `/files` (Bucket Explorer) to see every object in the bucket, including `video/recent/`, `video/archive/` and `video/manifests/`
- Folders auto-expand until most listed objects are visible; clicking an object previews it (MP4s play inline), with metadata and a "Detailed metadata" disclosure (checksums)
- Download works for any object
- Delete works for objects outside the managed `video/` prefixes. For a clip, sidecar or manifest the API answers 409 and the toast points to the Library, so no manifest line is ever orphaned
- See: [Bucket Explorer](features/file-browser.md)

## Change Preferences

- User opens `/settings`; the form opens pre-filled from this browser
- **Default project** pre-fills the Generate form; it must follow the project naming rule
- **Default share link lifetime** pre-selects the Share dialog
- **Theme** applies immediately (the header toggle drives the same state)
- Save stores the values in this browser; if storage is blocked, a warning says so and the theme still changes
- See: [Settings](features/settings.md)
