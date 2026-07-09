import { test, expect } from "@playwright/test";

for (const locale of ["en-US", "de-DE"]) {
  test(`checkout formats currency for locale (${locale})`, async ({ page }) => {
    await page.goto(`/checkout?locale=${locale}`);
    const expected = locale === "en-US" ? "$1,234.50" : "1.234,50 €";
    await expect(page.getByTestId("order-total")).toHaveText(expected);
  });
}

