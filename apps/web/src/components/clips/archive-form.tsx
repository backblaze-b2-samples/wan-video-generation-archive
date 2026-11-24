"use client";

import Link from "next/link";
import { useState } from "react";
import { Archive } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { clipHref } from "@/lib/clip-links";
import { formatDate } from "@/lib/utils";
import { useAgeProject, useProjects } from "@/lib/queries";

/**
 * Run the age job for one project: clips at least N days old move to
 * video/archive/<project>/<yyyy-mm>/ and their manifest keys are rewritten.
 * Dry run is on by default; `as_of` previews aging at a future date.
 */
export function ArchiveForm() {
  const { data: projects = [] } = useProjects();
  const age = useAgeProject();
  const [picked, setProject] = useState("");
  const [days, setDays] = useState("");
  const [asOf, setAsOf] = useState("");
  const [dryRun, setDryRun] = useState(true);

  // Until the user picks one, default to the first project.
  const project = picked || projects[0]?.name || "";

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
        },
      },
      {
        onSuccess: (r) =>
          toast.success(r.dry_run ? "Dry run finished" : "Age job finished", {
            description: `${r.moved.length} ${r.dry_run ? "would move" : "moved"}, ${r.kept_count} kept`,
          }),
        onError: (e) => toast.error("Age job failed", { description: e.message }),
      },
    );

  const result = age.data;

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
                {selected.recent_count} recent, {selected.archive_count} archived
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="archive-days">Older than (days)</Label>
            <Input id="archive-days" inputMode="numeric" placeholder="30" value={days}
              onChange={(e) => setDays(e.target.value)} aria-invalid={!daysValid} />
            <p className="text-xs text-muted-foreground">Leave empty for the server default (ARCHIVE_AFTER_DAYS, 30).</p>
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
              {result.dry_run ? "Would move" : "Moved"} {result.moved.length}, kept {result.kept_count}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 space-y-3 text-sm">
            <p className="text-muted-foreground">
              As of {new Date(result.as_of).toLocaleString()}, cutoff {new Date(result.cutoff).toLocaleString()}.
            </p>
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
