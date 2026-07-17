import { test, expect } from "@playwright/test";

test("cart badge updates after adding an item", async ({ page }) => {
  await page.goto("/products/cyan-notebook");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByTestId("cart-badge")).toHaveText("1");
});

