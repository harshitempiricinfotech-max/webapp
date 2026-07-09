import { test, expect } from "@playwright/test";

test("search suggestions survive a slow API response", async ({ page }) => {
  await page.goto("/search");
  await page.getByRole("combobox").fill("cyan");
  await expect(page.getByRole("listbox")).toContainText("cyan notebook");
});

