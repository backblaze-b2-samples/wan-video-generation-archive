"use client";

import { useEffect } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  ApiError,
  ageProject,
  deleteClip,
  deleteFile,
  generateClip,
  getClip,
  getClips,
  getDownloadUrl,
  getFileDetail,
  getFiles,
  getFileStats,
  getHealth,
  getJob,
  getJobs,
  getModels,
  getPreviewUrl,
  getProjects,
  regenerateClip,
  shareClip,
} from "@/lib/api-client";
import type {
  AgeJobRequest,
  AgeJobResult,
  ClipList,
  ClipRecord,
  FileMetadata,
  FileMetadataDetail,
  FileUrlResponse,
  GenerateClipRequest,
  GenerationJob,
  ModelInfo,
  ProjectSummary,
  ShareLink,
} from "@wan-video-generation-archive/shared";
import { qk } from "@/lib/generated/query-keys";

// Query keys are GENERATED from the API contract (`pnpm gen:api`) and their
// hierarchy is declared in `scripts/gen/api-gen.config.json`, so invalidating
// a parent key still reaches its children and no hook can invent a key the API
// cannot answer. Path parameters (project, clip id, job id) are appended to the
// generated key, so `qk.clips()`'s parent segment still covers every clip.
//
// The caching policy below — staleTime, refetchInterval, retry, `enabled`
// gating, the query-vs-mutation choice, and the cache surgery in
// `dropDeletedFileFromCache` — is hand-written on purpose and is never
// generated.
export { qk };

export type Health = Awaited<ReturnType<typeof getHealth>>;

/** How often an unfinished generation job is polled. */
export const JOB_POLL_MS = 1_500;

/**
 * Gate a query on something being open/visible. Deliberately the only option we
 * expose, so callers can't drift the caching policy per call site — the ⌘K
 * palette reuses `useFiles`' key (and therefore its cache) instead of fetching
 * its own private, smaller list.
 */
export interface QueryGate {
  enabled?: boolean;
}

export function isJobActive(job: Pick<GenerationJob, "status"> | undefined): boolean {
  return job?.status === "queued" || job?.status === "running";
}

// --- Bucket explorer ---------------------------------------------------------

export function useFiles(prefix = "", limit = 100, { enabled = true }: QueryGate = {}) {
  return useQuery<FileMetadata[], ApiError>({
    queryKey: qk.files(prefix, limit),
    queryFn: () => getFiles(prefix, limit),
    enabled,
  });
}

export function useFileStats({ enabled = true }: QueryGate = {}) {
  return useQuery({
    queryKey: qk.stats(),
    queryFn: getFileStats,
    enabled,
  });
}

// Presigned preview URL — only fetched when `enabled` is true (e.g., when
// the dialog opens for a specific file). Kept short-lived (60s) because
// the URL itself has a presigned expiry and is cheap to regenerate.
export function usePreviewUrl(key: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.preview(key ?? ""),
    queryFn: () => getPreviewUrl(key as string),
    enabled: enabled && !!key,
    staleTime: 60_000,
  });
}

// Rich metadata for an already-stored file. The server recomputes it on demand
// (a full object download), so it's only fetched when `enabled` — i.e. the
// preview dialog is open AND the user expands "Detailed metadata".
export function useFileDetail(key: string | undefined, enabled: boolean) {
  return useQuery<FileMetadataDetail, ApiError>({
    queryKey: qk.detail(key ?? ""),
    queryFn: () => getFileDetail(key as string),
    enabled: enabled && !!key,
    staleTime: 60_000,
  });
}

// Health poll for the top-of-app B2 banner. `retry: false` and letting a
// failed fetch leave `data` undefined keeps a down API silent (the
// per-component ErrorState covers that); the banner only reacts to an up API
// reporting b2_connected: false. Polls every 60s and on window focus.
export function useHealth() {
  return useQuery<Health>({
    queryKey: qk.health(),
    queryFn: getHealth,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Drop a deleted object from every cached file list, plus its own cached
 * preview/detail entries, so the row disappears with the toast; the
 * invalidation that follows still reconciles against the server.
 *
 * Exported for tests — the mutation below is its only production caller.
 */
export function dropDeletedFileFromCache(qc: QueryClient, fileKey: string) {
  qc.setQueriesData<FileMetadata[]>(
    // Partial key: matches qk.files(prefix, limit) for every prefix/limit.
    { queryKey: [...qk.all, "files"] },
    (previous) =>
      previous ? previous.filter((file) => file.key !== fileKey) : previous,
  );
  // A presigned URL for a deleted key can only 404 now.
  qc.removeQueries({ queryKey: qk.preview(fileKey) });
  qc.removeQueries({ queryKey: qk.detail(fileKey) });
}

/**
 * Fetch a download URL for one file. A mutation, not a query: it bumps the
 * server's download counter and must never be cached or replayed.
 */
export function useDownloadUrl() {
  const qc = useQueryClient();
  return useMutation<FileUrlResponse, ApiError, FileMetadata>({
    mutationFn: (file) => getDownloadUrl(file.key),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.stats() }),
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (fileKey: string) => deleteFile(fileKey),
    onSuccess: (_data, fileKey) => {
      dropDeletedFileFromCache(qc, fileKey);
      qc.invalidateQueries({ queryKey: qk.all });
    },
  });
}

// --- Models, projects, clips -------------------------------------------------

export function useModels() {
  return useQuery<ModelInfo[], ApiError>({
    queryKey: qk.models(),
    queryFn: getModels,
    staleTime: 30_000,
  });
}

export function useProjects() {
  return useQuery<ProjectSummary[], ApiError>({
    queryKey: qk.projects(),
    queryFn: getProjects,
  });
}

export function useClips(project?: string, tier = "all", q?: string) {
  return useQuery<ClipList, ApiError>({
    queryKey: qk.clips(project, tier, q),
    queryFn: () => getClips(project, tier, q),
    // A new search or filter keeps the current grid on screen while it loads.
    placeholderData: keepPreviousData,
  });
}

export function useClip(project: string | undefined, clipId: string | undefined) {
  return useQuery<ClipRecord, ApiError>({
    queryKey: [...qk.clip(), project, clipId],
    queryFn: () => getClip(project as string, clipId as string),
    enabled: !!project && !!clipId,
    retry: (count, error) => !error.isNotFound && count < 2,
  });
}

/** Everything a stored clip appears in: lists, detail, projects, the explorer. */
function invalidateClipViews(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: [...qk.all, "clips"] });
  qc.invalidateQueries({ queryKey: qk.projects() });
  qc.invalidateQueries({ queryKey: [...qk.all, "files"] });
  qc.invalidateQueries({ queryKey: qk.stats() });
}

// --- Jobs -------------------------------------------------------------------

export function useJobs() {
  return useQuery<GenerationJob[], ApiError>({
    queryKey: qk.jobs(),
    queryFn: getJobs,
    refetchInterval: (query) =>
      (query.state.data ?? []).some(isJobActive) ? JOB_POLL_MS * 2 : false,
  });
}

/**
 * Poll one job until it finishes. When it succeeds the new clip exists, so the
 * clip views are invalidated once; either outcome refreshes the job list.
 */
export function useJob(jobId: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery<GenerationJob, ApiError>({
    queryKey: [...qk.job(), jobId],
    queryFn: () => getJob(jobId as string),
    enabled: !!jobId,
    refetchInterval: (q) => (isJobActive(q.state.data) || !q.state.data ? JOB_POLL_MS : false),
  });
  const status = query.data?.status;
  useEffect(() => {
    if (status === "succeeded") invalidateClipViews(qc);
    // The job list stops polling once nothing is active, so refresh it now or
    // its row keeps the last running stage ("saving") with a spinner.
    if (status === "succeeded" || status === "failed") qc.invalidateQueries({ queryKey: qk.jobs() });
  }, [qc, status]);
  return query;
}

// --- Mutations --------------------------------------------------------------

export function useGenerateClip() {
  const qc = useQueryClient();
  return useMutation<GenerationJob, ApiError, GenerateClipRequest>({
    mutationFn: generateClip,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.jobs() }),
  });
}

export function useRegenerateClip() {
  const qc = useQueryClient();
  return useMutation<GenerationJob, ApiError, { project: string; clipId: string }>({
    mutationFn: ({ project, clipId }) => regenerateClip(project, clipId),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.jobs() }),
  });
}

export function useDeleteClip() {
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, { project: string; clipId: string }>({
    mutationFn: ({ project, clipId }) => deleteClip(project, clipId),
    onSuccess: () => invalidateClipViews(qc),
  });
}

/** A share link is minted per click (it expires), so it is a mutation, never cached. */
export function useShareClip() {
  const qc = useQueryClient();
  return useMutation<
    ShareLink,
    ApiError,
    { project: string; clipId: string; expiresInSeconds: number }
  >({
    mutationFn: ({ project, clipId, expiresInSeconds }) =>
      shareClip(project, clipId, expiresInSeconds),
    // A link for a recent clip writes `share_expires_at` (the archive hold).
    onSuccess: (_link, { project, clipId }) =>
      qc.invalidateQueries({ queryKey: [...qk.clip(), project, clipId] }),
  });
}

/**
 * Apply a finished (non-dry-run) age job to a cached project list, so the
 * recent/archived counts change with the result card instead of after the
 * refetch. Exported for tests; `useAgeProject` is its only production caller.
 */
export function applyAgeResult(
  projects: ProjectSummary[] | undefined,
  result: AgeJobResult,
): ProjectSummary[] | undefined {
  if (!projects || result.dry_run) return projects;
  const moved = result.moved.length;
  return projects.map((p) =>
    p.name === result.project
      ? {
          ...p,
          recent_count: Math.max(0, p.recent_count - moved),
          archive_count: p.archive_count + moved,
          held_count: Math.max(0, p.held_count - result.released.length),
        }
      : p,
  );
}

export function useAgeProject() {
  const qc = useQueryClient();
  return useMutation<AgeJobResult, ApiError, { project: string; body: AgeJobRequest }>({
    mutationFn: ({ project, body }) => ageProject(project, body),
    onSuccess: async (result) => {
      if (result.dry_run) return;
      await qc.cancelQueries({ queryKey: qk.projects() });
      qc.setQueryData<ProjectSummary[]>(qk.projects(), (prev) => applyAgeResult(prev, result));
      invalidateClipViews(qc);
    },
  });
}
