import { APP_SLUG } from "@/lib/app-config";

/**
 * The Generate form's unsent values, kept in `sessionStorage` so leaving the
 * page mid-run and coming back restores the prompt, project and settings
 * instead of the defaults. Per tab, cleared with the tab; a convenience only,
 * so every storage call is wrapped and a blocked or corrupt store reads as
 * "no draft".
 */

export const GENERATE_DRAFT_KEY = `${APP_SLUG}-generate-draft`;

export type GenerateDraft = Record<string, string>;

type DraftStorage = Pick<Storage, "getItem" | "setItem">;

function sessionStore(): DraftStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function loadGenerateDraft(storage: DraftStorage | undefined = sessionStore()): GenerateDraft | undefined {
  try {
    const raw = storage?.getItem(GENERATE_DRAFT_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const out: GenerateDraft = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === "string") out[k] = v;
    return out;
  } catch {
    return undefined;
  }
}

export function saveGenerateDraft(
  values: Record<string, unknown>,
  storage: DraftStorage | undefined = sessionStore(),
): void {
  const draft: GenerateDraft = {};
  for (const [k, v] of Object.entries(values)) if (typeof v === "string") draft[k] = v;
  try {
    storage?.setItem(GENERATE_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Quota or privacy mode: the form still works, it just won't be restored.
  }
}
