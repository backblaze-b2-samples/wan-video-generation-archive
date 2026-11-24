import { test, expect } from "@playwright/test";

// Smoke suite: every screen renders its heading. Generation itself needs the
// model on a GPU and is covered by services/api/live_tests/test_wan_archive_e2e.py.
const screens = [
  { path: "/", heading: "Library" },
  { path: "/generate", heading: "Generate" },
  { path: "/archive", heading: "Archive" },
  { path: "/files", heading: "Bucket Explorer" },
  { path: "/settings", heading: "Settings" },
];

for (const { path, heading } of screens) {
  test(`${path} renders`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  });
}

test("generate form pre-fills from a clip's settings", async ({ page }) => {
  await page.goto("/generate?prompt=A%20red%20fox&seed=42&project=fox-shots");
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue("A red fox");
  await expect(page.getByLabel("Seed")).toHaveValue("42");
  await expect(page.getByLabel("Project")).toHaveValue("fox-shots");
});
