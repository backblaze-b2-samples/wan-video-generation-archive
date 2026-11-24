import { FileBrowser } from "@/components/files/file-browser";

export default function FilesPage() {
  return (
    <div className="space-y-8">
      <div className="animate-fade-in flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <h1 className="page-title">Bucket Explorer</h1>
          <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
            Every object in the bucket, newest first. Click one to preview it.
            Clips, sidecars and manifests under <code>video/</code> are deleted
            from the Library so their manifest stays consistent.
          </p>
        </div>
      </div>
      <div className="animate-fade-in-up stagger-2">
        <FileBrowser />
      </div>
    </div>
  );
}
