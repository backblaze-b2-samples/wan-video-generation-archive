import type { GenerationJob, ModelInfo } from "@wan-video-generation-archive/shared";

/**
 * Pure helpers for the Generate and Clip screens: which model to pre-select,
 * which running job a page re-attaches to, and how a job's stage reads.
 */

/** The model the API marks as default (runnable here), else the first runnable one. */
export function defaultModelId(models: Pick<ModelInfo, "id" | "available" | "default">[]): string | undefined {
  return (models.find((m) => m.default) ?? models.find((m) => m.available) ?? models[0])?.id;
}

/**
 * The newest queued or running job that `match` accepts. The API's job list is
 * the source of truth, so a reload or a trip through the nav finds it again.
 */
export function findActiveJob(
  jobs: GenerationJob[],
  match: (job: GenerationJob) => boolean = () => true,
): GenerationJob | undefined {
  // The API lists jobs newest first.
  return jobs.find((j) => (j.status === "queued" || j.status === "running") && match(j));
}

export interface JobStageText {
  label: string;
  detail?: string;
  /** Only step-based stages have a meaningful percentage. */
  showProgress: boolean;
}

export function jobStageText(
  job: Pick<GenerationJob, "status" | "stage" | "stage_detail" | "step" | "total_steps">,
): JobStageText {
  const detail = job.stage_detail ?? undefined;
  if (job.status === "queued") {
    return { label: "Queued", detail: "Waiting for the GPU (one job at a time).", showProgress: false };
  }
  if (job.status !== "running") {
    return { label: job.status === "succeeded" ? "Succeeded" : "Failed", showProgress: true };
  }
  switch (job.stage) {
    case "downloading":
      return {
        label: "Downloading model weights (first run)",
        detail: detail ?? "Fetching the pinned weights from huggingface.co.",
        showProgress: false,
      };
    case "loading":
      return { label: "Loading model", detail, showProgress: false };
    case "saving":
      return { label: "Saving to B2", detail, showProgress: true };
    case "generating":
      return { label: `Generating: step ${job.step} / ${job.total_steps}`, showProgress: true };
    default:
      return { label: "Starting", showProgress: false };
  }
}

/**
 * "12 s in this stage" for a running stage with no step counter (download,
 * model load), so a long wait visibly moves. Counts from the API's
 * `stage_started_at`; null when there is nothing honest to show.
 */
export function stageElapsedText(
  job: Pick<GenerationJob, "status" | "stage" | "stage_started_at">,
  now: Date,
): string | null {
  if (job.status !== "running" || !job.stage_started_at) return null;
  if (job.stage !== "loading" && job.stage !== "downloading") return null;
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(job.stage_started_at).getTime()) / 1000));
  const m = Math.floor(seconds / 60);
  return `${m > 0 ? `${m} min ${seconds % 60} s` : `${seconds} s`} in this stage`;
}
