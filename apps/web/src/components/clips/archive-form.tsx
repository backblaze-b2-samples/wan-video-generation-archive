"use client";

import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Archive, Clapperboard } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProjectSummary } from "@wan-video-generation-archive/shared";
import { clipHref } from "@/lib/clip-links";
import { formatDate } from "@/lib/utils";
import { useAgeProject, useProjects } from "@/lib/queries";

/**
 * Run the age job for one project: clips at least N days old move to
 * video/archive/<project>/<yyyy-mm>/ and their manifest keys are rewritten.
 * Dry run is on by default; `as_of` previews aging at a future date.
 * `?project=&days=&include_held=` (the clip page's "Archive..." link) pre-fills
 * the form. Clips held by a live share link stay in Recent unless "Archive held
 * clips anyway" is on, which moves them and makes those links stop working.
 */
export function ArchiveForm() {
  const params = useSearchParams();
  const projectsQuery = useProjects();
  const projects = projectsQuery.data ?? [];
  const age = useAgeProject();
  const [picked, setProject] = useState(params.get("project") ?? "");
  const [days, setDays] = useState(params.get("days") ?? "");
  const [asOf, setAsOf] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [includeHeld, setIncludeHeld] = useState(params.get("include_held") === "1");

  // Until the user picks one (or the URL names a known one), default to the
  // project with the newest clip.
  const project =
    (projects.some((p) => p.name === picked) && picked) || mostRecentProject(projects) || "";

  const daysValid = days === "" || /^\d+$/.test(days);
  const selected = projects.find((p) => p.name === project);

  const run = () =>
    age.mutate(
      {
        project,
        body: {
          older_than_days: days === "" ? null : Number(days),
          as_of: asOf ? new Date(`${asOf}T23:59:59Z`).toISOString() : null,
          dry_run: dryRun,
          include_held: includeHeld,
        },
      },
      {
        onSuccess: (r) =>
          toast.success(r.dry_run ? "Dry run finished" : "Age job finished", {
            description: `${r.moved.length} ${r.dry_run ? "would move" : "moved"}, ${r.kept_count} kept in Recent${r.held.length ? ` (${r.held.length} held by a live share link)` : ""}${r.released.length ? `; ${r.released.length} ${r.dry_run ? "would lose" : "lost"} a live share link` : ""}`,
          }),
        onError: (e) => toast.error("Age job failed", { description: e.message }),
      },
    );

  const result = age.data;

  if (projectsQuery.isLoading) return <Skeleton className="h-64 w-full" />;
  if (projectsQuery.isSuccess && projects.length === 0) {
    return (
      <EmptyState
        icon={Archive}
        title="Nothing to archive yet"
        description="The age job moves a project's older clips to the archive tier. Generate a clip first; its project then appears here."
        action={
          <Button asChild size="sm">
            <Link href="/generate">
              <Clapperboard className="h-3.5 w-3.5" aria-hidden="true" />
              Generate a clip
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="border-b border-border py-4 px-5">
          <CardTitle className="card-title">Age job</CardTitle>
        </CardHeader>
        <CardContent className="p-5 grid gap-5 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="archive-project">Project</Label>
            <Select value={project} onValueChange={setProject}>
              <SelectTrigger id="archive-project" className="w-full">
                <SelectValue placeholder="No projects yet" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && (
              <p className="text-xs text-muted-foreground">
                {selected.recent_count} recent
                {selected.held_count > 0 && ` (${selected.held_count} held by a live share link)`},{" "}
                {selected.archive_count} archived
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="archive-days">Older than (days)</Label>
            <Input id="archive-days" inputMode="numeric" placeholder="30" value={days}
              onChange={(e) => setDays(e.target.value)} aria-invalid={!daysValid}
              aria-describedby={daysValid ? "archive-days-hint" : "archive-days-error archive-days-hint"} />
            {!daysValid && (
              <p id="archive-days-error" className="text-xs text-destructive">
                Enter a whole number of days, 0 or more (0 archives every recent clip).
              </p>
            )}
            <p id="archive-days-hint" className="text-xs text-muted-foreground">
              Only clips at least this old move. Empty uses the server default (ARCHIVE_AFTER_DAYS,
              30 days), so a clip made today stays in Recent; enter 0 to include every recent clip
              now.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="archive-asof">As of</Label>
            <Input id="archive-asof" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            <p className="text-xs text-muted-foreground">Leave empty for now; set a future date to preview aging.</p>
          </div>
          <div className="flex items-center gap-3 self-center">
            <Switch id="archive-dry" checked={dryRun} onCheckedChange={setDryRun} />
            <Label htmlFor="archive-dry">Dry run (report only, move nothing)</Label>
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <div className="flex items-center gap-3">
              <Switch id="archive-held" checked={includeHeld} onCheckedChange={setIncludeHeld}
                aria-describedby="archive-held-hint" />
              <Label htmlFor="archive-held">Archive held clips anyway (live links stop working)</Label>
            </div>
            <p id="archive-held-hint" className={includeHeld ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {includeHeld
                ? "Clips with a live share link move too. Each share link is signed for the clip's current key, so every outstanding link for a moved clip stops working; share it again from the clip page for a new link."
                : "Off: a clip with a live share link stays in Recent until its last link expires, so the link keeps working."}
            </p>
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button onClick={run} disabled={!project || !daysValid || age.isPending}>
              <Archive className="h-4 w-4" aria-hidden="true" />
              {age.isPending ? "Running..." : dryRun ? "Preview" : "Archive clips"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader className="border-b border-border py-4 px-5">
            <CardTitle className="card-title">
              {result.dry_run ? "Would move" : "Moved"} {result.moved.length}, kept in Recent {result.kept_count}
              {result.held.length > 0 && ` (${result.held.length} held)`}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3 text-sm">
            <p className="text-muted-foreground">
              As of {new Date(result.as_of).toLocaleString()}, cutoff {new Date(result.cutoff).toLocaleString()}.
            </p>
            {result.moved.length === 0 && result.kept_count > result.held.length && (
              <p className="text-muted-foreground">
                {result.kept_count - result.held.length} recent{" "}
                {result.kept_count - result.held.length === 1 ? "clip was" : "clips were"} created
                after the cutoff ({cutoffDays(result)} days before the as-of date), so nothing is
                old enough yet. Set Older than to 0 to include every recent clip now, or set As of
                to a later date to preview when they will move.
              </p>
            )}
            {result.held.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">
                  Held in Recent: a share link is signed for the clip&apos;s current key, so it is
                  not moved until its last link expires. A later run moves it, or turn on
                  &quot;Archive held clips anyway&quot; to move it now (its links stop working).
                </p>
                <ul className="divide-y divide-border">
                  {result.held.map((h) => (
                    <li key={h.clip_id} className="py-1.5 text-xs">
                      <Link href={clipHref(result.project, h.clip_id)} className="font-mono underline">
                        {h.clip_id}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        link expires {new Date(h.share_expires_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.released.length > 0 && (
              <div className="space-y-1">
                <p className="text-destructive">
                  {result.dry_run
                    ? "Would move despite a live share link: links for these clips would stop working."
                    : "Moved despite a live share link: links for these clips no longer work; share the clip again for a new link."}
                </p>
                <ul className="divide-y divide-border">
                  {result.released.map((h) => (
                    <li key={h.clip_id} className="py-1.5 text-xs">
                      <Link href={clipHref(result.project, h.clip_id)} className="font-mono underline">
                        {h.clip_id}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        link was valid until {new Date(h.share_expires_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.moved.length > 0 && (
              <ul className="divide-y divide-border">
                {result.moved.map((m) => (
                  <li key={m.clip_id} className="py-2 space-y-0.5">
                    <Link href={clipHref(result.project, m.clip_id)} className="font-mono text-xs underline">
                      {m.clip_id}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground break-all">
                      {m.from_key} → {m.to_key}
                    </div>
                    <div className="text-xs text-muted-foreground">created {formatDate(m.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** The project whose newest clip is the most recent, so the form opens where work happens. */
function mostRecentProject(projects: ProjectSummary[]): string | undefined {
  const time = (p: ProjectSummary) => (p.last_generated_at ? new Date(p.last_generated_at).getTime() : 0);
  return projects.reduce<ProjectSummary | undefined>((best, p) => (!best || time(p) > time(best) ? p : best), undefined)?.name;
}

/** The "Older than" a result was run with, in whole days. */
function cutoffDays(result: { as_of: string; cutoff: string }): number {
  return Math.round((new Date(result.as_of).getTime() - new Date(result.cutoff).getTime()) / 86_400_000);
}
