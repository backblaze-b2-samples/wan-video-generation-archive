import { describe, expect, it } from "vitest";

import { GENERATE_DRAFT_KEY, loadGenerateDraft, saveGenerateDraft } from "@/lib/generate-draft";

function memory(initial: Record<string, string> = {}) {
  const store = { ...initial };
  return {
    store,
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  };
}

describe("generate draft", () => {
  it("round-trips the string fields of the form", () => {
    const s = memory();
    saveGenerateDraft({ prompt: "a fox", project: "nature", seed: "", extra: 3 }, s);
    expect(loadGenerateDraft(s)).toEqual({ prompt: "a fox", project: "nature", seed: "" });
  });

  it("reads a missing, corrupt or non-object value as no draft", () => {
    expect(loadGenerateDraft(memory())).toBeUndefined();
    expect(loadGenerateDraft(memory({ [GENERATE_DRAFT_KEY]: "{not json" }))).toBeUndefined();
    expect(loadGenerateDraft(memory({ [GENERATE_DRAFT_KEY]: "[1]" }))).toBeUndefined();
    expect(loadGenerateDraft(undefined)).toBeUndefined();
  });

  it("never throws when storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(loadGenerateDraft(blocked)).toBeUndefined();
    expect(() => saveGenerateDraft({ prompt: "x" }, blocked)).not.toThrow();
  });
});
