import { describe, expect, it } from "vitest";
import type { GenerationJob } from "@wan-video-generation-archive/shared";
import { defaultModelId, findActiveJob, jobStageText, stageElapsedText } from "@/lib/generation";

function job(overrides: Partial<GenerationJob>): GenerationJob {
  return {
    job_id: "j1",
    kind: "generate",
    status: "running",
    project: "demo",
    prompt: "a red fox",
    stage: null,
    stage_detail: null,
    stage_started_at: null,
    step: 0,
    total_steps: 20,
    clip_id: null,
    regenerated_from: null,
    error: null,
    created_at: "2026-11-24T00:00:00Z",
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

describe("defaultModelId", () => {
  it("prefers the API default, then the first runnable model", () => {
    expect(
      defaultModelId([
        { id: "5b", available: false, default: false },
        { id: "1.3b", available: true, default: true },
      ]),
    ).toBe("1.3b");
    expect(
      defaultModelId([
        { id: "5b", available: false, default: false },
        { id: "1.3b", available: true, default: false },
      ]),
    ).toBe("1.3b");
    expect(defaultModelId([])).toBeUndefined();
  });
});

describe("findActiveJob", () => {
  const jobs = [
    job({ job_id: "new-done", status: "succeeded" }),
    job({ job_id: "regen", kind: "regenerate", regenerated_from: "c1" }),
    job({ job_id: "gen", status: "queued" }),
  ];

  it("returns the newest queued or running job", () => {
    expect(findActiveJob(jobs)?.job_id).toBe("regen");
  });

  it("honours the match filter", () => {
    expect(findActiveJob(jobs, (j) => j.kind === "generate")?.job_id).toBe("gen");
    expect(findActiveJob(jobs, (j) => j.regenerated_from === "c2")).toBeUndefined();
  });
});

describe("jobStageText", () => {
  it("names each running stage", () => {
    expect(jobStageText(job({ stage: "downloading", stage_detail: "1.2 GB downloaded" }))).toEqual({
      label: "Downloading model weights (first run)",
      detail: "1.2 GB downloaded",
      showProgress: false,
    });
    expect(jobStageText(job({ stage: "loading" })).label).toBe("Loading model");
    expect(jobStageText(job({ stage: "generating", step: 4 })).label).toBe("Generating: step 4 / 20");
    expect(jobStageText(job({ stage: "saving" })).label).toBe("Saving to B2");
    expect(jobStageText(job({})).label).toBe("Starting");
  });

  it("covers queued and finished jobs", () => {
    expect(jobStageText(job({ status: "queued" })).label).toBe("Queued");
    expect(jobStageText(job({ status: "succeeded" })).label).toBe("Succeeded");
    expect(jobStageText(job({ status: "failed" })).label).toBe("Failed");
  });
});

describe("stageElapsedText", () => {
  const started = "2026-11-24T00:00:00Z";
  it("counts seconds in a load or download stage", () => {
    const loading = job({ stage: "loading", stage_started_at: started });
    expect(stageElapsedText(loading, new Date("2026-11-24T00:00:12.900Z"))).toBe("12 s in this stage");
    expect(stageElapsedText(loading, new Date("2026-11-24T00:01:05Z"))).toBe("1 min 5 s in this stage");
    expect(stageElapsedText(job({ stage: "downloading", stage_started_at: started }), new Date(started))).toBe(
      "0 s in this stage",
    );
  });

  it("shows nothing for step-based stages or finished jobs", () => {
    const now = new Date("2026-11-24T00:00:12Z");
    expect(stageElapsedText(job({ stage: "generating", stage_started_at: started }), now)).toBeNull();
    expect(stageElapsedText(job({ status: "succeeded", stage_started_at: started }), now)).toBeNull();
    expect(stageElapsedText(job({ stage: "loading" }), now)).toBeNull();
  });
});
