"use client";

import Link from "next/link";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { clipHref } from "@/lib/clip-links";
import { formatDate } from "@/lib/utils";
import { isJobActive, useJob, useJobs } from "@/lib/queries";

/**
 * The job this page just queued (if any), plus the recent job history held by
 * the API process. Jobs run one at a time on the GPU, so queued jobs wait.
 */
export function JobProgress({ jobId }: { jobId?: string }) {
  const { data: job } = useJob(jobId);
  const { data: jobs = [] } = useJobs();
  const pct = job && job.total_steps > 0 ? Math.round((job.step / job.total_steps) * 100) : 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b border-border py-4 px-5">
          <CardTitle className="card-title">Current job</CardTitle>
        </CardHeader>
        <CardContent className="p-5 space-y-3 text-sm" aria-live="polite">
          {!job ? (
            <p className="text-muted-foreground">
              Submit the form to queue a clip. The first run downloads the pinned model weights
              from huggingface.co, which can take several minutes.
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                {isJobActive(job) ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : job.status === "succeeded" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
                )}
                <span className="font-medium capitalize">{job.status}</span>
                <span className="text-muted-foreground">
                  step {job.step} / {job.total_steps}
                </span>
              </div>
              <Progress value={pct} aria-label="Generation progress" />
              {job.status === "queued" && (
                <p className="text-muted-foreground">Waiting for the GPU (one job at a time).</p>
              )}
              {job.error && <p className="text-destructive break-words">{job.error}</p>}
              {job.clip_id && (
                <Button asChild size="sm">
                  <Link href={clipHref(job.project, job.clip_id)}>Open clip</Link>
                </Button>
              )}
            </>
          )}
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
                <li key={j.job_id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                  <div className="min-w-0">
                    <div className="font-mono text-xs truncate">{j.project}</div>
                    <div className="text-xs text-muted-foreground">
                      {j.kind} · {formatDate(j.created_at)}
                    </div>
                  </div>
                  {j.clip_id ? (
                    <Link className="text-xs underline" href={clipHref(j.project, j.clip_id)}>
                      {j.status}
                    </Link>
                  ) : (
                    <Badge variant={j.status === "failed" ? "destructive" : "secondary"}>{j.status}</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
