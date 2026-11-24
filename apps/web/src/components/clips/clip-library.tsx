"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive, Clapperboard, Clock, Film, Play } from "lucide-react";

import type { ClipRecord } from "@wan-video-generation-archive/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clipHref } from "@/lib/clip-links";
import { formatDate, humanizeBytes } from "@/lib/utils";
import { useClips, usePreviewUrl, useProjects } from "@/lib/queries";

const ALL = "__all__";
const TIERS = [
  { value: "all", label: "All tiers" },
  { value: "recent", label: "Recent" },
  { value: "archive", label: "Archive" },
];

/**
 * The sample's asset explorer, scoped to `video/`: one card per manifest entry,
 * filterable by project and tier, with an inline player. The full-bucket view
 * stays at /files.
 */
export function ClipLibrary() {
  const [project, setProject] = useState(ALL);
  const [tier, setTier] = useState("all");
  const [q, setQ] = useState("");
  const { data: projects = [] } = useProjects();
  const clips = useClips(project === ALL ? undefined : project, tier, q.trim() || undefined);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <Select value={project} onValueChange={setProject}>
          <SelectTrigger className="w-48" aria-label="Project"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All projects</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.name} value={p.name}>
                {p.name} ({p.clip_count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tier} onValueChange={setTier}>
          <SelectTrigger className="w-40" aria-label="Tier"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TIERS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search prompt or clip id"
          aria-label="Search clips"
          className="w-64"
        />
      </div>

      {clips.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : clips.isError ? (
        <ErrorState error={clips.error} title="Couldn't load clips" onRetry={() => clips.refetch()} />
      ) : (clips.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          icon={Film}
          title="No clips here yet"
          description="Generate a clip and it appears with its manifest entry."
          action={
            <Button asChild size="sm">
              <Link href="/generate">
                <Clapperboard className="h-3.5 w-3.5" aria-hidden="true" />
                Generate a clip
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clips.data?.items.map((clip) => <ClipCard key={`${clip.project}/${clip.clip_id}`} clip={clip} />)}
        </div>
      )}
    </div>
  );
}

function ClipCard({ clip }: { clip: ClipRecord }) {
  const [playing, setPlaying] = useState(false);
  const preview = usePreviewUrl(clip.output_key, playing);

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video bg-muted">
        {playing && preview.data ? (
          <video
            src={preview.data.url}
            controls
            autoPlay
            loop
            muted
            playsInline
            className="h-full w-full object-contain bg-black"
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="flex h-full w-full items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={`Play clip ${clip.clip_id}`}
          >
            <Play className="h-8 w-8" aria-hidden="true" />
          </button>
        )}
      </div>
      <CardContent className="p-4 space-y-2">
        <Link href={clipHref(clip.project, clip.clip_id)} className="line-clamp-2 text-sm font-medium hover:underline">
          {clip.prompt}
        </Link>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant={clip.tier === "archive" ? "secondary" : "outline"}>
            {clip.tier === "archive" ? <Archive aria-hidden="true" /> : <Clock aria-hidden="true" />}
            {clip.tier}
          </Badge>
          <Badge variant="outline">AI-generated</Badge>
          <span className="font-mono">{clip.project}</span>
          <span>· seed {clip.seed}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {formatDate(clip.created_at)} · {clip.width}x{clip.height} · {clip.num_frames} frames ·{" "}
          {humanizeBytes(clip.size_bytes)}
        </div>
      </CardContent>
    </Card>
  );
}
