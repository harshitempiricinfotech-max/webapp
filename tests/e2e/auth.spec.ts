import { test, expect } from "@playwright/test";

test("user can sign in after session expiry", async ({ page }) => {
  await page.goto("/sign-in?expired=1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/dashboard/);
});

