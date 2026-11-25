// GENERATED FILE — DO NOT EDIT.
//
// Written by `pnpm gen:api` from:
//   docs/api/openapi.json
//
// Hand edits are discarded by the next `pnpm gen:api`. `pnpm gen:check`
// (part of `pnpm verify:web`) fails while this file disagrees with the
// contract. To change what is here, change the FastAPI route or Pydantic
// model and re-run `pnpm contract:export && pnpm gen:api`.

export interface AgeJobRequest {
  /** Clock override; defaults to now. A future date previews aging. */
  as_of?: string | null;
  dry_run?: boolean;
  /** Also move clips held by a live share link; those links stop working. */
  include_held?: boolean;
  /** Defaults to ARCHIVE_AFTER_DAYS (30). */
  older_than_days?: number | null;
}

export interface AgeJobResult {
  as_of: string;
  cutoff: string;
  dry_run: boolean;
  /** Old enough, but kept in recent until their share link expires. */
  held: ArchiveHold[];
  /** Clips left in recent, including `held` ones. */
  kept_count: number;
  moved: ArchiveMove[];
  project: string;
  /**
   * Clips moved despite a live share link (include_held); those links now
   * fail.
   */
  released: ArchiveHold[];
}

/**
 * A clip old enough to archive, held in recent while a share link for its
 * key is live.
 */
export interface ArchiveHold {
  clip_id: string;
  share_expires_at: string;
}

export interface ArchiveMove {
  clip_id: string;
  created_at: string;
  from_key: string;
  to_key: string;
}

export interface ClipList {
  items: ClipRecord[];
}

/** One manifest line: everything needed to explain and reproduce a clip. */
export interface ClipRecord {
  ai_generated: boolean;
  ai_label: string;
  archived_at: string | null;
  clip_id: string;
  created_at: string;
  device: string | null;
  diffusers_version: string | null;
  fps: number;
  generation_seconds: number;
  guidance_scale: number;
  height: number;
  model: string;
  model_license: string;
  model_revision: string;
  negative_prompt: string | null;
  num_frames: number;
  num_inference_steps: number;
  /** Current key of the MP4, in whichever tier it sits. */
  output_key: string;
  project: string;
  prompt: string;
  regenerated_from: string | null;
  schema_version: number;
  seed: number;
  /** Current key of the settings sidecar JSON. */
  settings_key: string;
  sha256: string;
  /**
   * Latest expiry of a share link minted while the clip was recent. A
   * presigned link is bound to one key, so the age job keeps the clip in
   * recent until then.
   */
  share_expires_at: string | null;
  size_bytes: number;
  tier: string;
  torch_version: string | null;
  width: number;
}

export interface DeleteClipResponse {
  clip_id: string;
  deleted_keys: string[];
}

/** Acknowledgement that one object was removed from the bucket. */
export interface DeleteFileResponse {
  deleted: boolean;
  key: string;
}

/** One stored object as the file list and the by-key metadata route see it. */
export interface FileMetadata {
  content_type: string;
  filename: string;
  folder: string;
  key: string;
  size_bytes: number;
  size_human: string;
  uploaded_at: string;
  /**
   * Public object URL, set only when B2_PUBLIC_URL_BASE is configured and
   * the bucket is public. Null otherwise — the UI asks for a presigned URL
   * instead.
   */
  url: string | null;
}

/** Rich metadata recomputed on demand by re-reading the stored object. */
export interface FileMetadataDetail {
  /** Audio/video: bits per second. */
  bitrate: number | null;
  /** Audio/video: codec name. */
  codec: string | null;
  /** Audio/video: duration in seconds. */
  duration_seconds: number | null;
  /**
   * Image-specific: EXIF tags, values stringified. Null for non-images or
   * when no EXIF block was present.
   */
  exif: Record<string, string> | null;
  extension: string;
  filename: string;
  /** Image-specific: pixel height. Null for non-images. */
  image_height: number | null;
  /** Image-specific: pixel width. Null for non-images. */
  image_width: number | null;
  md5: string;
  /**
   * Set when a format-specific extractor was skipped or failed (e.g. an
   * image above Pillow's decompression-bomb limit). The core fields are
   * always exact, so the UI shows this instead of silently dropping the
   * Image / PDF section.
   */
  metadata_warning: string | null;
  mime_type: string;
  /** PDF-specific: author. */
  pdf_author: string | null;
  /** PDF-specific: page count. Null for non-PDFs. */
  pdf_pages: number | null;
  /** PDF-specific: title. */
  pdf_title: string | null;
  sha256: string;
  size_bytes: number;
  size_human: string;
  uploaded_at: string;
}

/** A short-lived presigned GET for downloading or previewing one object. */
export interface FileUrlResponse {
  /**
   * Presigned GET URL. Download URLs force an attachment disposition;
   * preview URLs are signed inline so a PDF renders in place.
   */
  url: string;
}

/**
 * Text-to-video request. Omitting `seed` picks a random one that is still
 * recorded.
 */
export interface GenerateClipRequest {
  guidance_scale?: number;
  model_id?: string;
  negative_prompt?: string | null;
  num_frames?: number;
  num_inference_steps?: number;
  project?: string;
  prompt: string;
  resolution?: string;
  seed?: number | null;
}

export interface GenerationJob {
  clip_id: string | null;
  created_at: string;
  error: string | null;
  finished_at: string | null;
  job_id: string;
  kind: string;
  project: string;
  prompt: string;
  regenerated_from: string | null;
  /** What a running job is doing now; null when not running. */
  stage: string | null;
  /** Human-readable progress for the stage (e.g. bytes downloaded). */
  stage_detail: string | null;
  /** When the current stage began; null when not running. */
  stage_started_at: string | null;
  started_at: string | null;
  status: string;
  step: number;
  total_steps: number;
}

export interface GenerationPreset {
  num_frames: number;
  num_inference_steps: number;
  resolution: string;
}

export interface HTTPValidationError {
  detail?: ValidationError[];
}

/**
 * Liveness plus B2 reachability. The route answers HTTP 200 even when B2
 * is unreachable, so a caller must read `b2_connected` rather than
 * trusting the status code.
 */
export interface HealthStatus {
  /** True when the bucket answered a cheap head request. */
  b2_connected: boolean;
  /** "healthy" when B2 answered, else "degraded". */
  status: string;
}

/** One pinned registry entry plus whether it is loaded on the GPU now. */
export interface ModelInfo {
  /**
   * Whether this model can run on the API's device; checked before any
   * download.
   */
  available: boolean;
  /**
   * The model the Generate form pre-selects: WAN_MODEL if it can run, else
   * the first model that can.
   */
  default: boolean;
  default_guidance: number;
  default_steps: number;
  /** Device of the loaded pipeline; null when not loaded. */
  device: string | null;
  fps: number;
  frame_options: number[];
  hf_repo: string;
  id: string;
  label: string;
  license: string;
  loaded: boolean;
  /**
   * Settings the Generate form starts from: the demo preset on CUDA, the
   * light preset elsewhere, where every step is much slower.
   */
  recommended: GenerationPreset;
  resolutions: ResolutionInfo[];
  /** Exact 40-hex Hugging Face commit the weights load from. */
  revision: string;
  /**
   * Device this API generates on (cuda, mps or cpu), probed without
   * loading weights; null when it cannot be determined.
   */
  run_device: string | null;
  /** Why the model cannot run here; null when available. */
  unavailable_reason: string | null;
}

export interface ProjectSummary {
  archive_count: number;
  clip_count: number;
  /**
   * Recent clips held there by a live share link (counted in
   * recent_count).
   */
  held_count: number;
  last_generated_at: string | null;
  manifest_key: string;
  name: string;
  recent_count: number;
}

export interface ResolutionInfo {
  height: number;
  name: string;
  width: number;
}

export interface ShareLink {
  expires_at: string;
  key: string;
  tier: string;
  url: string;
}

export interface ShareRequest {
  /**
   * Link lifetime; defaults to SHARE_LINK_TTL_SECONDS, clamped to
   * 60..604800.
   */
  expires_in_seconds?: number | null;
}

/** Aggregate whole-bucket figures (object count, size, downloads). */
export interface UploadStats {
  total_downloads: number;
  total_files: number;
  total_size_bytes: number;
  total_size_human: string;
  uploads_today: number;
}

export interface ValidationError {
  ctx?: Record<string, unknown>;
  input?: unknown;
  loc: (string | number)[];
  msg: string;
  type: string;
}
