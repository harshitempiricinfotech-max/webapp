import { test, expect } from "@playwright/test";

test("dismissing a notification updates unread count", async ({ page }) => {
  await page.goto("/notifications");
  await page.getByRole("button", { name: "Dismiss" }).first().click();
  await expect(page.getByTestId("unread-count")).toHaveText("2");
});

