import { expect, test } from "@playwright/test";

test.describe("backend-free public surfaces", () => {
  test("the demo renders its synthetic local catalog", async ({ page }) => {
    const response = await page.goto("/demo");

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Explore a curated knowledge base", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("12 entries", { exact: true })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(12);
    await expect(page.getByRole("link", { name: "Curio demo home" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  test("the login page remains public without provider configuration", async ({ page }) => {
    const response = await page.goto("/login");

    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Sign in to Curio", level: 1 })).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(
      "Authentication is not configured. Complete the environment and Supabase setup before signing in.",
    );
    await expect(page.getByRole("button", { name: "Sign in with Google" })).toHaveCount(0);
  });

  test("the protected dashboard never renders without a backend", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page).toHaveURL(/\/demo$/u);
    await expect(
      page.getByRole("heading", { name: "Explore a curated knowledge base", level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Submissions" })).toHaveCount(0);
  });
});
