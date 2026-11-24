import Link from "next/link";
import { Clapperboard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClipLibrary } from "@/components/clips/clip-library";

export default function LibraryPage() {
  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Library</h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-prose">
            Every generated clip, recent or archived, with the prompt, seed and pinned model
            revision that produced it.
          </p>
        </div>
        <Button asChild size="sm" className="h-8">
          <Link href="/generate">
            <Clapperboard className="h-3.5 w-3.5" aria-hidden="true" />
            Generate a clip
          </Link>
        </Button>
      </div>
      <div className="animate-fade-in-up stagger-2">
        <ClipLibrary />
      </div>
    </div>
  );
}
