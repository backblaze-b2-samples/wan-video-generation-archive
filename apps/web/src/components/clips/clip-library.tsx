"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, Clapperboard, Clock, Film, Link2, Loader2, Play } from "lucide-react";

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
import { clipHref, heldUntil } from "@/lib/clip-links";
import { formatDate, humanizeBytes } from "@/lib/utils";
import { useClips, usePreviewUrl, useProjects } from "@/lib/queries";

const ALL = "__all__";
/** Search waits this long after the last keystroke before querying the API. */
export const SEARCH_DEBOUNCE_MS = 300;
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
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);
  const { data: projects = [] } = useProjects();
  const clips = useClips(project === ALL ? undefined : project, tier, search || undefined);
  // The grid keeps the previous results while a new search or filter loads.
  const searching = q.trim() !== search || clips.isPlaceholderData;

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
        {searching && (
          <span role="status" className="flex items-center gap-1.5 self-center text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Searching...
          </span>
        )}
      </div>

      {clips.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 w-full" />)}
        </div>
      ) : clips.isError ? (
        <ErrorState error={clips.error} title="Couldn't load clips" onRetry={() => clips.refetch()} />
      ) : (clips.data?.items.length ?? 0) === 0 ? (
        search || project !== ALL || tier !== "all" ? (
          <EmptyState
            icon={Film}
            title={search ? `No clips match "${search}"` : "No clips match these filters"}
            description="Search looks in prompts and clip ids, ignoring case. Clear the search or widen the project and tier filters."
          />
        ) : (
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
        )
      ) : (
        <div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 transition-opacity data-[stale=true]:opacity-60"
          data-stale={clips.isPlaceholderData}
          aria-busy={clips.isPlaceholderData}
        >
          {clips.data?.items.map((clip) => <ClipCard key={`${clip.project}/${clip.clip_id}`} clip={clip} />)}
        </div>
      )}
    </div>
  );
}

function ClipCard({ clip }: { clip: ClipRecord }) {
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Every card gets a presigned URL so its <video> can paint the first frame.
  // preload="metadata" on a faststart MP4 fetches the index and that frame,
  // not the whole clip; the #t fragment makes Safari paint it too.
  const preview = usePreviewUrl(clip.output_key, true);
  const held = heldUntil(clip);

  const play = () => {
    setPlaying(true);
    void videoRef.current?.play().catch(() => undefined);
  };

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video bg-black">
        {preview.data ? (
          <video
            ref={videoRef}
            src={`${preview.data.url}#t=0.1`}
            preload="metadata"
            controls={playing}
            loop
            muted
            playsInline
            aria-label={`Clip ${clip.clip_id}`}
            className="h-full w-full object-contain"
          />
        ) : preview.isLoading ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : null}
        {!playing && (
          <button
            type="button"
            onClick={play}
            disabled={!preview.data}
            className="absolute inset-0 flex items-center justify-center text-white/90 hover:text-white disabled:cursor-default"
            aria-label={`Play clip ${clip.clip_id}`}
          >
            <span className="rounded-full bg-black/50 p-3">
              <Play className="h-6 w-6" aria-hidden="true" />
            </span>
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
          {held && (
            <Badge variant="outline" title="A share link for this clip is live, so the age job keeps it in Recent until then">
              <Link2 aria-hidden="true" />
              shared until {held.toLocaleString()}
            </Badge>
          )}
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
