import { test, expect } from "@playwright/test";

test("checkout completes with tax quote", async ({ page }) => {
  await page.goto("/checkout");
  await page.getByRole("button", { name: "Calculate tax" }).click();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
});

