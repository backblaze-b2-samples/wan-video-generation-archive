"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import type { GenerationJob } from "@wan-video-generation-archive/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { clipHref } from "@/lib/clip-links";
import { findActiveJob, jobStageText, stageElapsedText } from "@/lib/generation";
import { formatDate } from "@/lib/utils";
import { isJobActive, useJob, useJobs } from "@/lib/queries";

/**
 * The current job plus the recent job history held by the API process. Jobs
 * run one at a time on the GPU, so queued jobs wait.
 *
 * The current job is, in order: a row the user clicked, the job this page just
 * queued (`jobId`), or the newest active job `match` accepts from the API's job
 * list. The last one is what re-attaches the card after a reload or a trip
 * through the nav, since React state does not survive either.
 *
 * `onSucceeded` fires once when the job this card is following (queued here or
 * re-attached, not a clicked history row) is seen going from active to
 * succeeded, so a page can open the new clip without a manual click. A job that
 * had already finished before the card saw it running never fires it.
 */
export function JobProgress({
  jobId,
  match,
  idleText,
  onSucceeded,
}: {
  jobId?: string;
  match?: (job: GenerationJob) => boolean;
  idleText: string;
  onSucceeded?: (job: GenerationJob) => void;
}) {
  const { data: jobs = [] } = useJobs();
  const [selected, setSelected] = useState<string>();
  const [adopted, setAdopted] = useState<string>();
  const [queuedId, setQueuedId] = useState(jobId);
  // A newly queued job takes over from a clicked row.
  if (jobId !== queuedId) {
    setQueuedId(jobId);
    setSelected(undefined);
  }
  // Keep the adopted job after it finishes, so the card shows its outcome.
  const active = findActiveJob(jobs, match);
  if (!jobId && active && active.job_id !== adopted) setAdopted(active.job_id);

  const { data: job } = useJob(selected ?? jobId ?? adopted);

  const following = !selected && job !== undefined && job.job_id === (jobId ?? adopted);
  const seenActive = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!following || !job) return;
    if (isJobActive(job)) seenActive.current = job.job_id;
    else if (job.status === "succeeded" && seenActive.current === job.job_id) {
      seenActive.current = undefined;
      onSucceeded?.(job);
    }
  }, [following, job, onSucceeded]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b border-border py-4 px-5">
          <CardTitle className="card-title">Current job</CardTitle>
        </CardHeader>
        <CardContent className="p-5 space-y-3 text-sm" aria-live="polite">
          {!job ? <p className="text-muted-foreground">{idleText}</p> : <JobCard job={job} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-border py-4 px-5">
          <CardTitle className="card-title">Recent jobs</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {jobs.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No jobs since the API started.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {jobs.slice(0, 8).map((j) => (
                <li key={j.job_id}>
                  <button
                    type="button"
                    onClick={() => setSelected(j.job_id)}
                    aria-current={job?.job_id === j.job_id ? "true" : undefined}
                    aria-label={`Show ${j.kind} job for ${j.project} (${j.status}) in Current job`}
                    className="flex w-full items-center justify-between gap-2 px-5 py-2.5 text-left hover:bg-muted/50 aria-[current=true]:bg-muted"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs">{j.prompt}</div>
                      <div className="text-xs text-muted-foreground">
                        <span className="font-mono">{j.project}</span> · {j.kind} · {formatDate(j.created_at)}
                      </div>
                    </div>
                    {isJobActive(j) ? (
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                        {j.status === "running" && j.stage === "generating"
                          ? `${j.step}/${j.total_steps}`
                          : (j.stage ?? j.status)}
                      </span>
                    ) : (
                      <Badge variant={j.status === "failed" ? "destructive" : "secondary"}>{j.status}</Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function JobCard({ job }: { job: GenerationJob }) {
  const text = jobStageText(job);
  // Tick once a second while a stage has no step counter (model load, download).
  const [now, setNow] = useState(() => new Date());
  const ticking =
    job.status === "running" && (job.stage === "loading" || job.stage === "downloading");
  useEffect(() => {
    if (!ticking) return;
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  const elapsed = stageElapsedText(job, now);
  const pct = job.total_steps > 0 ? Math.round((job.step / job.total_steps) * 100) : 0;
  return (
    <>
      <div className="flex items-center gap-2">
        {isJobActive(job) ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : job.status === "succeeded" ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
        ) : (
          <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        )}
        <span className="font-medium">{text.label}</span>
      </div>
      <p className="line-clamp-2 text-xs text-muted-foreground">
        <span className="font-mono">{job.project}</span> · {job.prompt}
      </p>
      {text.showProgress && (
        // The kit's Progress (components/ui, never edited) styles the bar from
        // `value` but does not forward it to the Radix root, which then reports
        // an indeterminate bar with no aria-valuenow. Set the ARIA and state
        // attributes here; Radix spreads them over its own defaults.
        <Progress
          value={pct}
          aria-label="Generation progress"
          aria-valuenow={pct}
          aria-valuetext={`${pct}%`}
          data-state={pct >= 100 ? "complete" : "loading"}
          data-value={pct}
        />
      )}
      {text.detail && <p className="text-muted-foreground">{text.detail}</p>}
      {elapsed && (
        // Not inside the aria-live region's churn: announce the stage, not every second.
        <p className="text-xs tabular-nums text-muted-foreground" aria-live="off">{elapsed}</p>
      )}
      {job.error && <p className="text-destructive break-words">{job.error}</p>}
      {job.clip_id && (
        <Button asChild size="sm">
          <Link href={clipHref(job.project, job.clip_id)}>Open clip</Link>
        </Button>
      )}
    </>
  );
}
