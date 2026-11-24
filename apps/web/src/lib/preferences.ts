/**
 * Browser-local preferences that the app genuinely uses:
 * - `defaultProject` pre-fills the project on the Generate form;
 * - `defaultShareTtl` pre-selects the lifetime in the Share dialog.
 *
 * Stored in `localStorage` (there is no account system). Theme is NOT here: it
 * is owned by `next-themes` (see `theme-preference.ts`).
 */

import { APP_SLUG } from "@/lib/app-config";

/** Share link lifetimes the UI offers, in seconds (the API clamps to 60..604800). */
export const SHARE_TTL_OPTIONS = [
  { seconds: 900, label: "15 min" },
  { seconds: 3600, label: "1 h" },
  { seconds: 86_400, label: "24 h" },
  { seconds: 604_800, label: "7 days" },
] as const;

export type ShareTtlSeconds = (typeof SHARE_TTL_OPTIONS)[number]["seconds"];

/** Same rule as the API's project names: `^[a-z0-9][a-z0-9-]{0,62}$`. */
export const PROJECT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface Preferences {
  defaultProject: string;
  defaultShareTtl: ShareTtlSeconds;
}

export const PREFERENCES_DEFAULTS: Preferences = {
  defaultProject: "demo",
  defaultShareTtl: 3600,
};

/** Namespaced by app slug so two of these apps on one origin cannot collide. */
export const PREFERENCES_STORAGE_KEY = `${APP_SLUG}-preferences`;

export function isShareTtl(value: unknown): value is ShareTtlSeconds {
  return SHARE_TTL_OPTIONS.some((o) => o.seconds === value);
}

export function shareTtlLabel(seconds: number): string {
  return SHARE_TTL_OPTIONS.find((o) => o.seconds === seconds)?.label ?? `${seconds}s`;
}

/**
 * Read stored preferences, falling back field by field on a missing, corrupt or
 * partial blob. SSR-safe: returns the defaults when there is no `window`.
 */
export function loadPreferences(): Preferences {
  if (typeof window === "undefined") return { ...PREFERENCES_DEFAULTS };
  let stored: unknown;
  try {
    const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...PREFERENCES_DEFAULTS };
    stored = JSON.parse(raw);
  } catch {
    return { ...PREFERENCES_DEFAULTS };
  }
  if (typeof stored !== "object" || stored === null) return { ...PREFERENCES_DEFAULTS };
  const s = stored as Record<string, unknown>;
  return {
    defaultProject:
      typeof s.defaultProject === "string" && PROJECT_NAME_RE.test(s.defaultProject)
        ? s.defaultProject
        : PREFERENCES_DEFAULTS.defaultProject,
    defaultShareTtl: isShareTtl(s.defaultShareTtl)
      ? s.defaultShareTtl
      : PREFERENCES_DEFAULTS.defaultShareTtl,
  };
}

/** Persist preferences. Returns false when storage is unavailable or blocked. */
export function savePreferences(values: Preferences): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(values));
    return true;
  } catch {
    return false;
  }
}
