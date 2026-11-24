import { describe, expect, it } from "vitest";

import { settingsSchema, type SettingsValues } from "@/lib/settings-schema";

const valid: SettingsValues = {
  theme: "dark",
  defaultProject: "demo",
  defaultShareTtl: "3600",
};

describe("settingsSchema", () => {
  it("accepts a valid form", () => {
    expect(settingsSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects project names the API would refuse", () => {
    for (const name of ["", "Demo", "-x", "a/b", "a".repeat(64)]) {
      expect(settingsSchema.safeParse({ ...valid, defaultProject: name }).success).toBe(false);
    }
  });

  it("only accepts offered share lifetimes", () => {
    expect(settingsSchema.safeParse({ ...valid, defaultShareTtl: "604800" }).success).toBe(true);
    expect(settingsSchema.safeParse({ ...valid, defaultShareTtl: "5" }).success).toBe(false);
  });
});
