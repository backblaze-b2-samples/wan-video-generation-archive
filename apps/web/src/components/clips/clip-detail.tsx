"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCcw, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { ClipRecord } from "@wan-video-generation-archive/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ShareDialog } from "@/components/clips/share-dialog";
import { JobProgress } from "@/components/clips/job-progress";
import { formatDuration, generateHrefFromClip, resolutionName } from "@/lib/clip-links";
import { humanizeBytes } from "@/lib/utils";
import {
  useClip,
  useDeleteClip,
  useModels,
  usePreviewUrl,
  useRegenerateClip,
} from "@/lib/queries";

export function ClipDetail({ project, clipId }: { project?: string; clipId?: string }) {
  const clip = useClip(project, clipId);
  if (!project || !clipId) {
    return <ErrorState title="No clip selected" description="Open a clip from the Library." />;
  }
  if (clip.isLoading) return <Skeleton className="h-96 w-full" />;
  if (clip.isError || !clip.data) {
    return <ErrorState error={clip.error} title="Couldn't load this clip" onRetry={() => clip.refetch()} />;
  }
  return <ClipView clip={clip.data} />;
}

function ClipView({ clip }: { clip: ClipRecord }) {
  const router = useRouter();
  const preview = usePreviewUrl(clip.output_key, true);
  const { data: models = [] } = useModels();
  const regenerate = useRegenerateClip();
  const remove = useDeleteClip();
  const model = models.find((m) => m.id === clip.model);
  const pinned = !!model && model.revision === clip.model_revision;
  const resolution = model ? resolutionName(clip, model.resolutions) : undefined;

  const onDelete = () =>
    remove.mutate(
      { project: clip.project, clipId: clip.clip_id },
      {
        onSuccess: () => {
          toast.success("Clip deleted", { description: "Its objects and manifest line are gone." });
          router.push("/");
        },
        onError: (e) => toast.error("Delete failed", { description: e.message }),
      },
    );

  const fields: [string, string][] = [
    ["Clip id", clip.clip_id],
    ["Project", clip.project],
    ["Seed", String(clip.seed)],
    ["Model", clip.model],
    ["Model revision", clip.model_revision],
    ["License", clip.model_license],
    ["Size", `${clip.width}x${clip.height}, ${clip.num_frames} frames @ ${clip.fps} fps`],
    ["Steps / guidance", `${clip.num_inference_steps} / ${clip.guidance_scale}`],
    ["Device", clip.device ?? "unknown"],
    ["Generation time", formatDuration(clip.generation_seconds)],
    ["Diffusers / torch", `${clip.diffusers_version ?? "?"} / ${clip.torch_version ?? "?"}`],
    ["Object key", clip.output_key],
    ["Settings sidecar", clip.settings_key],
    ["SHA-256", clip.sha256],
    ["File size", humanizeBytes(clip.size_bytes)],
    ["Created", new Date(clip.created_at).toLocaleString()],
    ["Archived", clip.archived_at ? new Date(clip.archived_at).toLocaleString() : "not yet"],
    ["Regenerated from", clip.regenerated_from ?? "none"],
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Card className="overflow-hidden">
          <div className="aspect-video bg-black">
            {preview.data ? (
              <video src={preview.data.url} controls loop playsInline className="h-full w-full object-contain" />
            ) : (
              <Skeleton className="h-full w-full" />
            )}
          </div>
          <CardContent className="p-5 space-y-3">
            <p className="text-sm">{clip.prompt}</p>
            {clip.negative_prompt && (
              <p className="text-xs text-muted-foreground">Negative: {clip.negative_prompt}</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={clip.tier === "archive" ? "secondary" : "outline"}>{clip.tier}</Badge>
              <Badge variant="outline">{clip.ai_label}</Badge>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <ShareDialog project={clip.project} clipId={clip.clip_id} />
              <Button
                variant="outline"
                size="sm"
                disabled={!pinned || regenerate.isPending}
                title={pinned ? undefined : "This revision is not in the pinned registry"}
                onClick={() =>
                  regenerate.mutate(
                    { project: clip.project, clipId: clip.clip_id },
                    {
                      onSuccess: () => toast.success("Regeneration queued"),
                      onError: (e) => toast.error("Could not regenerate", { description: e.message }),
                    },
                  )
                }
              >
                <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Regenerate
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href={generateHrefFromClip(clip, resolution)}>
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  Use these settings
                </Link>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this clip?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Removes the MP4, its settings sidecar and its manifest line from B2. This
                      cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete}>Delete clip</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-border py-4 px-5">
            <CardTitle className="card-title">Manifest entry</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
              {fields.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-mono text-xs break-all">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
      <JobProgress jobId={regenerate.data?.job_id} />
    </div>
  );
}
