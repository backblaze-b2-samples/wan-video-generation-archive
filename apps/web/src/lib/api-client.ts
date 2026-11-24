import type {
  AgeJobRequest,
  AgeJobResult,
  ClipList,
  ClipRecord,
  DeleteClipResponse,
  DeleteFileResponse,
  FileMetadata,
  FileMetadataDetail,
  FileUrlResponse,
  GenerateClipRequest,
  GenerationJob,
  HealthStatus,
  ModelInfo,
  ProjectSummary,
  ShareLink,
  UploadStats,
} from "@wan-video-generation-archive/shared";

import { API_CLIENT_ROUTES } from "./generated/api-routes";

// The route registry is GENERATED from the API contract (`pnpm gen:api`), so
// it cannot drift from FastAPI. Re-exported from here because this module is
// the frontend's API surface: consumers and the contract test import it from
// `lib/api-client`, and that import path should not change just because the
// registry moved behind a generator.
//
// Everything else in this file is hand-written on purpose — error policy, base
// URL resolution, the legacy-route fallback and the CORS diagnostics are
// per-app judgement the contract does not describe. See
// `scripts/gen/api-gen.config.json` (`escapeHatch`).
export { API_CLIENT_ROUTES };

// Single-origin deploys (Vercel `services`: one project serving web + API) put
// the API under /api on the same origin, so no NEXT_PUBLIC_API_URL is needed —
// a production build with it unset defaults to the relative "/api". An explicit
// NEXT_PUBLIC_API_URL still wins (two-project / separate-origin deploys). Local
// dev (NODE_ENV !== "production") falls back to the dev API port.
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:8000");

/** Typed API error with HTTP status code for caller-side branching. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** True for 408, 429, 500, 502, 503, 504 — worth retrying. */
  get isRetryable(): boolean {
    return [408, 429, 500, 502, 503, 504].includes(this.status);
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

/**
 * Build the right status-0 ApiError for a thrown fetch().
 *
 * fetch() rejects with a TypeError for genuinely-offline/DNS failures AND for
 * responses the browser refused to expose — most notably a cross-origin 500
 * that shipped without `Access-Control-Allow-Origin`. We can't tell those apart
 * from the error object, but `navigator.onLine === false` reliably means the
 * device has no connectivity. Anything else reached the network, so the most
 * likely cause is the server erroring with a CORS-blocked response — point the
 * developer at the API logs instead of blaming their connection.
 */
function networkError(): ApiError {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return new ApiError("You appear to be offline — check your connection", 0);
  }
  return new ApiError(
    "Couldn't reach the API, or the server returned an error the browser blocked (CORS). Check the API logs.",
    0,
  );
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw networkError();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      body.detail || `API error: ${res.status}`,
      res.status,
    );
  }
  return res.json();
}

function isEndpointUnavailable(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.status === 404 &&
    (error.message === "Not Found" || error.message === "API error: 404")
  );
}

async function apiFetchWithLegacyFallback<T>(
  path: string,
  legacyPath: () => string,
  init?: RequestInit
): Promise<T> {
  try {
    return await apiFetch<T>(path, init);
  } catch (error) {
    if (isEndpointUnavailable(error)) {
      return apiFetch<T>(legacyPath(), init);
    }
    throw error;
  }
}

function fileKeyQuery(key: string): string {
  if (key.length === 0) {
    throw new ApiError("File key is required", 400);
  }
  return new URLSearchParams({ key }).toString();
}

function legacyFileKeyPath(
  key: string,
  options: { blockRouteCollisions?: boolean } = {}
): string {
  if (!isLegacyPathFallbackSafe(key, options)) {
    throw new ApiError("Current API version required for this file key", 404);
  }
  return encodeURIComponent(key);
}

/**
 * Substitute a file key into a legacy `{key}` path template. The parameter type
 * requires the literal `{key}` placeholder, so passing a registry path that has
 * no placeholder is a compile error rather than a silent no-op that would send
 * the request to a keyless URL.
 */
function legacyFileKeyRoute(
  path: `${string}{key}${string}`,
  key: string,
  options: { blockRouteCollisions?: boolean } = {}
): string {
  return path.replace("{key}", legacyFileKeyPath(key, options));
}

function isLegacyPathFallbackSafe(
  key: string,
  { blockRouteCollisions = false }: { blockRouteCollisions?: boolean } = {}
): boolean {
  if (/(\.\.\/|\/\.\.|\\|%2e%2e|%00|\x00)/i.test(key)) return false;
  if (!blockRouteCollisions) return true;

  const lowerKey = key.toLowerCase();
  if (lowerKey === "stats" || lowerKey === "stats/activity") return false;
  if (lowerKey.endsWith("/download") || lowerKey.endsWith("/preview")) return false;
  return true;
}

export async function getHealth() {
  return apiFetch<HealthStatus>(API_CLIENT_ROUTES.health.path);
}

export async function getFiles(prefix = "", limit = 100) {
  return apiFetch<FileMetadata[]>(
    `${API_CLIENT_ROUTES.files.path}?prefix=${encodeURIComponent(prefix)}&limit=${limit}`
  );
}

export async function getFileStats() {
  return apiFetch<UploadStats>(API_CLIENT_ROUTES.fileStats.path);
}

export async function getFile(key: string) {
  return apiFetchWithLegacyFallback<FileMetadata>(
    `${API_CLIENT_ROUTES.fileByKeyMetadata.path}?${fileKeyQuery(key)}`,
    () =>
      legacyFileKeyRoute(API_CLIENT_ROUTES.legacyFileMetadata.path, key, {
        blockRouteCollisions: true,
      })
  );
}

/**
 * Rich metadata (checksums, image/PDF fields) for an already-stored file.
 * The server recomputes this on demand by downloading the object, so it's a
 * heavier call than getFile — fetch it lazily (only when the user asks to see
 * details). No legacy path fallback: this endpoint is new, so an older backend
 * wouldn't serve it under any route.
 */
export async function getFileDetail(key: string) {
  return apiFetch<FileMetadataDetail>(
    `${API_CLIENT_ROUTES.fileByKeyDetail.path}?${fileKeyQuery(key)}`
  );
}

export async function getDownloadUrl(key: string) {
  return apiFetchWithLegacyFallback<FileUrlResponse>(
    `${API_CLIENT_ROUTES.fileByKeyDownload.path}?${fileKeyQuery(key)}`,
    () => legacyFileKeyRoute(API_CLIENT_ROUTES.legacyFileDownload.path, key)
  );
}

/** Preview-only presigned URL — does NOT increment the download counter. */
export async function getPreviewUrl(key: string) {
  return apiFetchWithLegacyFallback<FileUrlResponse>(
    `${API_CLIENT_ROUTES.fileByKeyPreview.path}?${fileKeyQuery(key)}`,
    () => legacyFileKeyRoute(API_CLIENT_ROUTES.legacyFilePreview.path, key)
  );
}

export async function deleteFile(key: string) {
  return apiFetchWithLegacyFallback<DeleteFileResponse>(
    `${API_CLIENT_ROUTES.fileByKeyDelete.path}?${fileKeyQuery(key)}`,
    () => legacyFileKeyRoute(API_CLIENT_ROUTES.legacyFileDelete.path, key),
    {
      // Derived from the registry so the verb the contract test checks is the
      // verb actually sent — a hardcoded "DELETE" could silently disagree.
      method: API_CLIENT_ROUTES.fileByKeyDelete.method.toUpperCase(),
    }
  );
}

// --- Clips, projects, jobs ---------------------------------------------------

/** Substitute `{name}` placeholders in a registry path with encoded values. */
export function fillPath(path: string, params: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined || value === "") {
      throw new ApiError(`Missing path parameter: ${name}`, 400);
    }
    return encodeURIComponent(value);
  });
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method: method.toUpperCase(),
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export async function getModels() {
  return apiFetch<ModelInfo[]>(API_CLIENT_ROUTES.models.path);
}

export async function getProjects() {
  return apiFetch<ProjectSummary[]>(API_CLIENT_ROUTES.projects.path);
}

export async function getClips(project?: string, tier = "all", q?: string) {
  const params = new URLSearchParams({ tier });
  if (project) params.set("project", project);
  if (q) params.set("q", q);
  return apiFetch<ClipList>(`${API_CLIENT_ROUTES.clips.path}?${params}`);
}

export async function getClip(project: string, clipId: string) {
  return apiFetch<ClipRecord>(
    fillPath(API_CLIENT_ROUTES.clip.path, { project, clip_id: clipId })
  );
}

export async function generateClip(body: GenerateClipRequest) {
  const route = API_CLIENT_ROUTES.generateClip;
  return apiFetch<GenerationJob>(route.path, jsonInit(route.method, body));
}

export async function deleteClip(project: string, clipId: string) {
  const route = API_CLIENT_ROUTES.deleteClip;
  return apiFetch<DeleteClipResponse>(
    fillPath(route.path, { project, clip_id: clipId }),
    { method: route.method.toUpperCase() }
  );
}

export async function shareClip(project: string, clipId: string, expiresInSeconds: number) {
  const route = API_CLIENT_ROUTES.shareClip;
  return apiFetch<ShareLink>(
    fillPath(route.path, { project, clip_id: clipId }),
    jsonInit(route.method, { expires_in_seconds: expiresInSeconds })
  );
}

export async function regenerateClip(project: string, clipId: string) {
  const route = API_CLIENT_ROUTES.regenerateClip;
  return apiFetch<GenerationJob>(
    fillPath(route.path, { project, clip_id: clipId }),
    { method: route.method.toUpperCase() }
  );
}

export async function ageProject(project: string, body: AgeJobRequest) {
  const route = API_CLIENT_ROUTES.ageProject;
  return apiFetch<AgeJobResult>(
    fillPath(route.path, { project }),
    jsonInit(route.method, body)
  );
}

export async function getJobs() {
  return apiFetch<GenerationJob[]>(API_CLIENT_ROUTES.jobs.path);
}

export async function getJob(jobId: string) {
  return apiFetch<GenerationJob>(fillPath(API_CLIENT_ROUTES.job.path, { job_id: jobId }));
}
