import { describe, expect, it } from "vitest";

import type { ClipRecord } from "@wan-video-generation-archive/shared";
import {
  archiveHrefForClip,
  clipHref,
  heldUntil,
  formatDuration,
  generateHrefFromClip,
  readGenerateDefaults,
  resolutionName,
} from "@/lib/clip-links";

const clip = {
  project: "demo",
  clip_id: "20260101T000000Z-deadbeef",
  prompt: "A fox & a hare",
  negative_prompt: "blurry",
  seed: 42,
  model: "wan2.2-ti2v-5b",
  width: 832,
  height: 480,
  num_frames: 49,
  num_inference_steps: 30,
  guidance_scale: 5,
} as ClipRecord;

describe("clip links", () => {
  it("opens the Archive page with the project and the clip's age in whole days", () => {
    const created = { project: "nature", created_at: "2026-11-20T12:00:00Z" };
    expect(archiveHrefForClip(created, new Date("2026-11-24T11:00:00Z"))).toBe(
      "/archive?project=nature&days=3",
    );
    expect(archiveHrefForClip(created, new Date("2026-11-20T12:05:00Z"))).toBe(
      "/archive?project=nature&days=0",
    );
  });

  it("marks a clip held while its share link is live, and asks the Archive form to include it", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    const shared = {
      project: "nature",
      created_at: "2026-11-24T11:00:00Z",
      tier: "recent" as const,
      share_expires_at: "2026-11-24T13:00:00Z",
    };
    expect(heldUntil(shared, now)?.toISOString()).toBe("2026-11-24T13:00:00.000Z");
    expect(archiveHrefForClip(shared, now)).toBe("/archive?project=nature&days=0&include_held=1");
    const expired = { ...shared, share_expires_at: "2026-11-24T11:30:00Z" };
    expect(heldUntil(expired, now)).toBeNull();
    expect(archiveHrefForClip(expired, now)).toBe("/archive?project=nature&days=0");
    expect(heldUntil({ ...shared, tier: "archive" }, now)).toBeNull();
  });

  it("builds a detail link", () => {
    expect(clipHref("demo", clip.clip_id)).toBe(
      "/clip?project=demo&id=20260101T000000Z-deadbeef"
    );
  });

  it("round-trips a clip's settings through the Generate URL", () => {
    const href = generateHrefFromClip(clip, "480p");
    const defaults = readGenerateDefaults(new URL(href, "http://x").searchParams);
    expect(defaults).toEqual({
      project: "demo",
      prompt: "A fox & a hare",
      negative_prompt: "blurry",
      seed: "42",
      model_id: "wan2.2-ti2v-5b",
      resolution: "480p",
      num_frames: "49",
      num_inference_steps: "30",
      guidance_scale: "5",
    });
  });

  it("maps a clip size back to a preset", () => {
    const presets = [{ name: "480p", width: 832, height: 480 }];
    expect(resolutionName(clip, presets)).toBe("480p");
    expect(resolutionName({ width: 1, height: 1 }, presets)).toBeUndefined();
  });

  it("formats generation time", () => {
    expect(formatDuration(12.34)).toBe("12.3 s");
    expect(formatDuration(125)).toBe("2 min 5 s");
  });
});
