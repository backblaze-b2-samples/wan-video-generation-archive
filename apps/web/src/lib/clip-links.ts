import type { ClipRecord } from "@wan-video-generation-archive/shared";

/**
 * URL helpers shared by the Library, clip detail and Generate screens.
 *
 * "Use these settings" on a clip opens /generate pre-filled from its manifest
 * entry; it creates a new clip and never edits the old one (a clip's prompt,
 * seed, model and revision are its provenance).
 */

export function clipHref(project: string, clipId: string): string {
  return `/clip?${new URLSearchParams({ project, id: clipId })}`;
}

export const STEP_OPTIONS = [20, 30, 40, 50] as const;

export interface GenerateDefaults {
  project?: string;
  prompt?: string;
  negative_prompt?: string;
  seed?: string;
  model_id?: string;
  resolution?: string;
  num_frames?: string;
  num_inference_steps?: string;
  guidance_scale?: string;
}

const GENERATE_FIELDS: (keyof GenerateDefaults)[] = [
  "project",
  "prompt",
  "negative_prompt",
  "seed",
  "model_id",
  "resolution",
  "num_frames",
  "num_inference_steps",
  "guidance_scale",
];

/** Resolution preset name for a clip's size, if the model still offers it. */
export function resolutionName(
  clip: Pick<ClipRecord, "width" | "height">,
  presets: { name: string; width: number; height: number }[],
): string | undefined {
  return presets.find((p) => p.width === clip.width && p.height === clip.height)?.name;
}

export function generateHrefFromClip(clip: ClipRecord, resolution?: string): string {
  const params = new URLSearchParams({
    project: clip.project,
    prompt: clip.prompt,
    seed: String(clip.seed),
    model_id: clip.model,
    num_frames: String(clip.num_frames),
    num_inference_steps: String(clip.num_inference_steps),
    guidance_scale: String(clip.guidance_scale),
  });
  if (clip.negative_prompt) params.set("negative_prompt", clip.negative_prompt);
  if (resolution) params.set("resolution", resolution);
  return `/generate?${params}`;
}

export function readGenerateDefaults(params: URLSearchParams): GenerateDefaults {
  const out: GenerateDefaults = {};
  for (const field of GENERATE_FIELDS) {
    const value = params.get(field);
    if (value !== null) out[field] = value;
  }
  return out;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  return `${m} min ${Math.round(seconds - m * 60)} s`;
}
