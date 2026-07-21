import { test, expect } from "@playwright/test";

test("dashboard loads analytics cards after refresh", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Refresh analytics" }).click();
  await expect(page.getByTestId("analytics-card").first()).toBeVisible();
});

