import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PREFERENCES_DEFAULTS,
  PREFERENCES_STORAGE_KEY,
  loadPreferences,
  savePreferences,
  shareTtlLabel,
} from "@/lib/preferences";

function stubStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    },
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("preferences", () => {
  it("returns defaults with no window or no stored value", () => {
    expect(loadPreferences()).toEqual(PREFERENCES_DEFAULTS);
    stubStorage();
    expect(loadPreferences()).toEqual(PREFERENCES_DEFAULTS);
  });

  it("round-trips valid values", () => {
    const store = stubStorage();
    expect(savePreferences({ defaultProject: "fox-shots", defaultShareTtl: 86_400 })).toBe(true);
    expect(JSON.parse(store[PREFERENCES_STORAGE_KEY])).toEqual({
      defaultProject: "fox-shots",
      defaultShareTtl: 86_400,
    });
    expect(loadPreferences().defaultShareTtl).toBe(86_400);
  });

  it("falls back per field on invalid stored values", () => {
    stubStorage({
      [PREFERENCES_STORAGE_KEY]: JSON.stringify({ defaultProject: "Bad Name", defaultShareTtl: 5 }),
    });
    expect(loadPreferences()).toEqual(PREFERENCES_DEFAULTS);
  });

  it("labels TTLs", () => {
    expect(shareTtlLabel(3600)).toBe("1 h");
    expect(shareTtlLabel(42)).toBe("42s");
  });
});
