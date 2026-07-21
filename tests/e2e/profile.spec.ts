import { test, expect } from "@playwright/test";

test("user updates display name from settings", async ({ page }) => {
  await page.goto("/settings/profile");
  await page.getByLabel("Display name").fill("Fixture User");
  await page.locator(".settings-panel .save-button").click();
  await expect(page.getByRole("status")).toHaveText("Profile saved");
});

