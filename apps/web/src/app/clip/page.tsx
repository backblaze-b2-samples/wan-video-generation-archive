"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";
import { ClipDetail } from "@/components/clips/clip-detail";

function ClipFromUrl() {
  const params = useSearchParams();
  return (
    <ClipDetail
      project={params.get("project") ?? undefined}
      clipId={params.get("id") ?? undefined}
    />
  );
}

export default function ClipPage() {
  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Clip</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Play, share, regenerate or delete one clip, and read its full manifest entry.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ClipFromUrl />
      </Suspense>
    </div>
  );
}
