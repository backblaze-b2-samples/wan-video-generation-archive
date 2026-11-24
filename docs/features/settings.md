<!-- last_verified: 2026-11-24 -->
# Feature: Settings

## Purpose
Let a user set the defaults this app actually uses: the project new clips go into, the lifetime of share links, and the theme.

## Used By
- UI: `/settings` page (`SettingsForm`); the values are read by the Generate form and the Share dialog
- API: none. There is no account system
- Storage: `next-themes`' own key for Theme; `localStorage` (`<app slug>-preferences`) for the default project and share lifetime

## Core Functions
- `apps/web/src/lib/preferences.ts`: `Preferences`, `PREFERENCES_DEFAULTS`, `SHARE_TTL_OPTIONS`, `loadPreferences()`, `savePreferences()`
- `apps/web/src/lib/settings-schema.ts`: validation rules and messages (zod)
- `apps/web/src/components/settings/settings-form.tsx`: the form, opened pre-filled
- `apps/web/src/lib/theme-preference.ts`: `THEME_OPTIONS`, `normalizeTheme()`

## Canonical Files
- Form pattern: `apps/web/src/components/settings/settings-form.tsx`

## Inputs
- `defaultProject`: text, `^[a-z0-9][a-z0-9-]{0,62}$` (the API's project rule), default `demo`
- `defaultShareTtl`: Select of 15 min / 1 h / 24 h / 7 days, default 1 h
- `theme`: `light | dark | system`

## Outputs
- Theme applied immediately; the other two persisted to this browser
- Generate pre-fills `project` from `defaultProject` unless the URL names one; the Share dialog pre-selects `defaultShareTtl` each time it opens

## Edge Cases
- Corrupt or partial stored blob -> each field falls back to its default
- Storage blocked (private mode) -> warning toast; theme still changes

## UX States
- Opens pre-filled from storage; Reset restores defaults; Save shows a toast

## Verification
- Test files: `apps/web/src/lib/preferences.test.ts`, `apps/web/src/lib/settings-schema.test.ts`, `apps/web/src/lib/theme-preference.test.ts`
- Focused verify command: `pnpm test:web`
- Default pre-PR verify command: `pnpm verify`
- Pass criteria: schema and storage cases green

## Related Docs
- [share-links.md](share-links.md)
- [clip-generation.md](clip-generation.md)
