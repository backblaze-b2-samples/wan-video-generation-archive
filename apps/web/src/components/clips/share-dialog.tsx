"use client";

import { useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SHARE_TTL_OPTIONS, loadPreferences, type ShareTtlSeconds } from "@/lib/preferences";
import { useShareClip } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Mint an expiring presigned link for a clip, in whichever tier it sits. */
export function ShareDialog({ project, clipId }: { project: string; clipId: string }) {
  const [open, setOpen] = useState(false);
  const [ttl, setTtl] = useState<ShareTtlSeconds>(3600);
  const share = useShareClip();

  // Each opening starts from the saved default lifetime and no stale link.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setTtl(loadPreferences().defaultShareTtl);
      share.reset();
    }
    setOpen(next);
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.warning("Copy failed; select the link and copy it manually");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Share link
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share this clip</DialogTitle>
          <DialogDescription>
            A presigned link plays the clip in a browser without making the bucket public. It
            stops working when it expires. It is signed for the clip&apos;s current key, so the
            age job keeps a recent clip in Recent until its last link expires.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Link lifetime" className="inline-flex rounded-md border border-border p-0.5">
          {SHARE_TTL_OPTIONS.map((o) => (
            <button
              key={o.seconds}
              type="button"
              role="radio"
              aria-checked={ttl === o.seconds}
              onClick={() => setTtl(o.seconds)}
              className={cn(
                "rounded px-3 py-1.5 text-sm",
                ttl === o.seconds ? "bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <Button
          onClick={() =>
            share.mutate(
              { project, clipId, expiresInSeconds: ttl },
              { onError: (e) => toast.error("Could not create link", { description: e.message }) },
            )
          }
          disabled={share.isPending}
        >
          {share.isPending ? "Signing..." : "Create link"}
        </Button>
        {share.data && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input readOnly value={share.data.url} aria-label="Share link" className="font-mono text-xs" />
              <Button variant="outline" size="icon" aria-label="Copy link" onClick={() => copy(share.data.url)}>
                <Copy className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Expires {new Date(share.data.expires_at).toLocaleString()} · {share.data.tier} tier
              {share.data.tier === "recent" && " · not archived before then"}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
