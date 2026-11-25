"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { Skeleton } from "@/components/ui/skeleton";
import { GenerateForm } from "@/components/clips/generate-form";
import { readGenerateDefaults } from "@/lib/clip-links";

function GenerateFromUrl() {
  const params = useSearchParams();
  // `key` remounts the form when "Use these settings" brings new values.
  return <GenerateForm key={params.toString()} prefill={readGenerateDefaults(params)} />;
}

export default function GeneratePage() {
  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Generate</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-prose">
          Text-to-video with an open Wan model on this machine: TI2V-5B needs a CUDA GPU with 24 GB
          or more, the 1.3B model also runs on Apple Silicon. The clip, its settings and a manifest
          line are written to B2, labelled AI-generated.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <GenerateFromUrl />
      </Suspense>
    </div>
  );
}
