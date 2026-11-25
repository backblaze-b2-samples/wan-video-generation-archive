import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";
import { applyAgeResult, dropDeletedFileFromCache, isJobActive, qk } from "@/lib/queries";
import type { FileMetadata } from "@wan-video-generation-archive/shared";

function file(key: string): FileMetadata {
  return {
    key,
    filename: key.split("/").pop() ?? key,
    folder: "video/",
    size_bytes: 10,
    size_human: "10 B",
    content_type: "text/plain",
    uploaded_at: "2026-07-28T00:00:00Z",
    url: null,
  };
}

describe("dropDeletedFileFromCache", () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient();
  });

  it("removes the deleted row from the default list", () => {
    qc.setQueryData(qk.files(), [file("video/a.txt"), file("video/b.txt")]);

    dropDeletedFileFromCache(qc, "video/a.txt");

    expect(qc.getQueryData<FileMetadata[]>(qk.files())).toEqual([
      file("video/b.txt"),
    ]);
  });

  it("removes it from every cached prefix/limit variant", () => {
    qc.setQueryData(qk.files(), [file("video/a.txt")]);
    qc.setQueryData(qk.files("video/", 100), [file("video/a.txt")]);
    qc.setQueryData(qk.files("", 25), [file("video/a.txt")]);

    dropDeletedFileFromCache(qc, "video/a.txt");

    expect(qc.getQueryData<FileMetadata[]>(qk.files())).toEqual([]);
    expect(qc.getQueryData<FileMetadata[]>(qk.files("video/", 100))).toEqual(
      [],
    );
    expect(qc.getQueryData<FileMetadata[]>(qk.files("", 25))).toEqual([]);
  });

  it("evicts the deleted key's presigned URL and detail so Preview can't 404", () => {
    qc.setQueryData(qk.preview("video/a.txt"), { url: "https://signed" });
    qc.setQueryData(qk.detail("video/a.txt"), { md5: "abc" });

    dropDeletedFileFromCache(qc, "video/a.txt");

    expect(qc.getQueryData(qk.preview("video/a.txt"))).toBeUndefined();
    expect(qc.getQueryData(qk.detail("video/a.txt"))).toBeUndefined();
  });

  it("leaves other files' cached previews alone", () => {
    qc.setQueryData(qk.preview("video/b.txt"), { url: "https://signed-b" });

    dropDeletedFileFromCache(qc, "video/a.txt");

    expect(qc.getQueryData(qk.preview("video/b.txt"))).toEqual({
      url: "https://signed-b",
    });
  });

  it("does not touch stats or clip caches", () => {
    qc.setQueryData(qk.stats(), { total_files: 2 });
    qc.setQueryData(qk.clips(), { items: [{ clip_id: "c1" }] });

    dropDeletedFileFromCache(qc, "video/a.txt");

    expect(qc.getQueryData(qk.stats())).toEqual({ total_files: 2 });
    expect(qc.getQueryData<{ items: unknown[] }>(qk.clips())?.items).toHaveLength(1);
  });

  it("is a no-op for an unseeded cache", () => {
    expect(() =>
      dropDeletedFileFromCache(qc, "video/missing.txt"),
    ).not.toThrow();
    expect(qc.getQueryData(qk.files())).toBeUndefined();
  });
});

describe("isJobActive", () => {
  it("polls only queued and running jobs", () => {
    expect(isJobActive({ status: "queued" })).toBe(true);
    expect(isJobActive({ status: "running" })).toBe(true);
    expect(isJobActive({ status: "succeeded" })).toBe(false);
    expect(isJobActive({ status: "failed" })).toBe(false);
    expect(isJobActive(undefined)).toBe(false);
  });
});

describe("applyAgeResult", () => {
  const project = (name: string, recent: number, archived: number, held = 0) => ({
    name,
    clip_count: recent + archived,
    recent_count: recent,
    archive_count: archived,
    held_count: held,
    manifest_key: `video/manifests/${name}.jsonl`,
    last_generated_at: null,
  });
  const result = (dry_run: boolean) => ({
    project: "demo",
    as_of: "2027-01-01T00:00:00Z",
    cutoff: "2026-12-01T00:00:00Z",
    moved: [
      { clip_id: "a", from_key: "x", to_key: "y", created_at: "2026-11-01T00:00:00Z" },
      { clip_id: "b", from_key: "x", to_key: "y", created_at: "2026-11-01T00:00:00Z" },
    ],
    kept_count: 0,
    held: [],
    released: [{ clip_id: "a", share_expires_at: "2027-01-01T01:00:00Z" }],
    dry_run,
  });

  it("moves the counts of the aged project only", () => {
    const out = applyAgeResult([project("demo", 2, 0), project("other", 1, 0)], result(false));
    expect(out?.map((p) => [p.name, p.recent_count, p.archive_count])).toEqual([
      ["demo", 0, 2],
      ["other", 1, 0],
    ]);
  });

  it("drops the held count by the clips archived despite a live link", () => {
    const out = applyAgeResult([project("demo", 2, 0, 1)], result(false));
    expect(out?.[0].held_count).toBe(0);
  });

  it("leaves the counts alone for a dry run", () => {
    const before = [project("demo", 2, 0)];
    expect(applyAgeResult(before, result(true))).toBe(before);
  });
});
