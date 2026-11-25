import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { ArchiveForm } from "@/components/clips/archive-form";

export default function ArchivePage() {
  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Archive</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-prose">
          Move clips older than N days from <code>video/recent/</code> to{" "}
          <code>video/archive/</code> and rewrite their manifest keys. Each move is copied,
          verified by checksum, recorded, and only then removed from the recent tier.
        </p>
      </div>
      <div className="animate-fade-in-up stagger-2 max-w-4xl">
        {/* ArchiveForm reads ?project=&days= (useSearchParams needs a boundary). */}
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <ArchiveForm />
        </Suspense>
      </div>
    </div>
  );
}
