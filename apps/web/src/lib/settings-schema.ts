import { z } from "zod";

import { PROJECT_NAME_RE, SHARE_TTL_OPTIONS } from "@/lib/preferences";
import { THEME_OPTIONS } from "@/lib/theme-preference";

/**
 * Validation for the Settings form (`components/settings/settings-form.tsx`).
 *
 * Kept outside the component so the rules and their user-facing messages are
 * unit-tested without rendering the form. See `docs/features/settings.md`.
 * The share lifetime is a string because the Select binds strings.
 */
export const settingsSchema = z.object({
  theme: z.enum(THEME_OPTIONS),
  defaultProject: z
    .string()
    .regex(
      PROJECT_NAME_RE,
      "Use lowercase letters, digits and hyphens, starting with a letter or digit"
    ),
  defaultShareTtl: z.enum(
    SHARE_TTL_OPTIONS.map((o) => String(o.seconds)) as [string, ...string[]]
  ),
});

export type SettingsValues = z.infer<typeof settingsSchema>;
