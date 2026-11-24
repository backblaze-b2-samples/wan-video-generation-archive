import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  deleteFile,
  getDownloadUrl,
  getFile,
  getFileDetail,
  getPreviewUrl,
  fillPath,
  generateClip,
  shareClip,
} from "./api-client";

type FileKeyOperation = {
  call: (key: string) => Promise<unknown>;
  legacyPath: (key: string) => string;
  method: "GET" | "DELETE";
  name: string;
  path: string;
  unsafeFallbackKeys: { key: string }[];
};

const operations: FileKeyOperation[] = [
  {
    call: getFile,
    legacyPath: (key) => `/files/${encodeURIComponent(key)}`,
    method: "GET",
    name: "getFile",
    path: "/files-by-key/metadata",
    unsafeFallbackKeys: [
      "stats",
      "stats/activity",
      "payroll/download",
      "payroll/preview",
      "reports/download",
      "reports/preview",
      "../secret.txt",
      "video/%2e%2e/secret.txt",
    ].map((key) => ({ key })),
  },
  {
    call: getDownloadUrl,
    legacyPath: (key) => `/files/${encodeURIComponent(key)}/download`,
    method: "GET",
    name: "getDownloadUrl",
    path: "/files-by-key/download",
    unsafeFallbackKeys: ["../secret.txt", "video/%2e%2e/secret.txt"].map((key) => ({
      key,
    })),
  },
  {
    call: getPreviewUrl,
    legacyPath: (key) => `/files/${encodeURIComponent(key)}/preview`,
    method: "GET",
    name: "getPreviewUrl",
    path: "/files-by-key/preview",
    unsafeFallbackKeys: ["../secret.txt", "video/%2e%2e/secret.txt"].map((key) => ({
      key,
    })),
  },
  {
    call: deleteFile,
    legacyPath: (key) => `/files/${encodeURIComponent(key)}`,
    method: "DELETE",
    name: "deleteFile",
    path: "/files-by-key",
    unsafeFallbackKeys: ["../secret.txt", "video/%2e%2e/secret.txt"].map((key) => ({
      key,
    })),
  },
];

const keyCases = [
  "folder/file.txt",
  "folder/file #1?.txt",
  "folder/100% complete.txt",
  "../secret.txt",
  "video/%2e%2e/secret.txt",
  "stats",
  "stats/activity",
  "tenant-a/reports/download",
  "tenant-a/reports/preview",
].map((key) => ({ key }));

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function errorResponse(status: number, detail: string) {
  return new Response(JSON.stringify({ detail }), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function requestedPath(callIndex = 0) {
  const [input] = fetchMock.mock.calls[callIndex];
  const url = new URL(input as string);
  return `${url.pathname}${url.search}`;
}

async function expectEmptyKeyRejected(call: FileKeyOperation["call"]) {
  try {
    await call("");
    throw new Error("Expected empty key to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.message).toBe("File key is required");
    expect(apiError.status).toBe(400);
  }
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({}));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe.each(operations)(
  "$name",
  ({ call, legacyPath, method, path, unsafeFallbackKeys }) => {
    it.each(keyCases)("sends '$key' as a query parameter", async ({ key }) => {
      await call(key);

      expect(requestedPath()).toBe(`${path}?${new URLSearchParams({ key })}`);
      const init = fetchMock.mock.calls[0][1];
      expect(init?.method ?? "GET").toBe(method);
    });

    it("rejects empty keys before making a request", async () => {
      await expectEmptyKeyRejected(call);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("falls back to the legacy route when the query route is unavailable", async () => {
      const key = "video/report final.txt";
      fetchMock
        .mockResolvedValueOnce(errorResponse(404, "Not Found"))
        .mockResolvedValueOnce(jsonResponse({ key }));

      await call(key);

      expect(requestedPath(0)).toBe(`${path}?${new URLSearchParams({ key })}`);
      expect(requestedPath(1)).toBe(legacyPath(key));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not fall back when the current API reports a missing file", async () => {
      const key = "stats";
      fetchMock.mockResolvedValueOnce(errorResponse(404, "File not found"));

      await expect(call(key)).rejects.toMatchObject({
        message: "File not found",
        status: 404,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(unsafeFallbackKeys)(
      "does not fall back for unsafe legacy path key '$key'",
      async ({ key }) => {
        fetchMock.mockResolvedValueOnce(errorResponse(404, "Not Found"));

        await expect(call(key)).rejects.toMatchObject({
          message: "Current API version required for this file key",
          status: 404,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    );
  }
);

// getFileDetail is a new endpoint with NO legacy path fallback (an older backend
// wouldn't serve it under any route), so it's tested on its own rather than in
// the shared legacy-fallback harness above.
describe("getFileDetail", () => {
  it.each(keyCases)("sends '$key' as a query parameter", async ({ key }) => {
    await getFileDetail(key);

    expect(requestedPath()).toBe(
      `/files-by-key/detail?${new URLSearchParams({ key })}`
    );
    const init = fetchMock.mock.calls[0][1];
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("rejects empty keys before making a request", async () => {
    await expectEmptyKeyRejected(getFileDetail);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fall back on 404 — it surfaces the error in one request", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(404, "Not Found"));

    await expect(getFileDetail("video/gone.png")).rejects.toMatchObject({
      status: 404,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("clip routes", () => {
  it("encodes path parameters and refuses missing ones", () => {
    expect(
      fillPath("/projects/{project}/clips/{clip_id}", {
        project: "demo",
        clip_id: "20260101T000000Z-deadbeef",
      })
    ).toBe("/projects/demo/clips/20260101T000000Z-deadbeef");
    expect(() => fillPath("/projects/{project}/archive", {})).toThrow(ApiError);
  });

  it("posts a generation request as JSON", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ job_id: "j1", status: "queued" }));
    await generateClip({
      project: "demo",
      prompt: "A red fox",
      model_id: "wan2.2-ti2v-5b",
      resolution: "480p",
      num_frames: 49,
      num_inference_steps: 30,
      guidance_scale: 5,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/clips$/);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body)).prompt).toBe("A red fox");
  });

  it("sends the share lifetime", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ url: "https://signed" }));
    await shareClip("demo", "c1", 900);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/projects\/demo\/clips\/c1\/share$/);
    expect(JSON.parse(String(init?.body))).toEqual({ expires_in_seconds: 900 });
  });
});
