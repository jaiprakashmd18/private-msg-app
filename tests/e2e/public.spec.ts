import { expect, test } from "@playwright/test";

test("validates sign-in, toggles the password, and opens the privacy notice", async ({ page }) => {
  await page.goto("/login");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: /valid email/i })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill("tester@example.test");
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: /enter your password/i })).toBeVisible();

  const password = page.locator("#login-password");
  await password.fill("test-password");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");

  await page.getByRole("link", { name: "Privacy notice" }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "Privacy notice", exact: true })).toBeVisible();
});

test("protects signed-out pages and returns a generic OAuth refusal", async ({ page }) => {
  for (const path of ["/chat", "/settings", "/admin/users", "/admin/audit", "/admin/requests"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
  }
  await page.goto("/auth/callback?error=access_denied&error_description=not+authorized+by+the+provider");
  await expect(page).toHaveURL(/\/login\?error=not_authorized$/);
  await expect(page.getByRole("alert").filter({ hasText: /isn't approved/i })).toBeVisible();
});

test("publishes the app manifest and favicon", async ({ page, request }) => {
  await page.goto("/login");
  const favicon = await page.locator('link[rel="icon"]').getAttribute("href");
  expect(favicon).toBeTruthy();
  expect((await request.get(favicon!)).ok()).toBe(true);
  const manifest = await request.get("/manifest.webmanifest");
  expect((await manifest.json()).start_url).toBe("/chat");
});

for (const width of [320, 375, 390, 768, 1024, 1440, 1920]) {
  test(`sign-in fits at ${width}px in dark and light mode`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/login");
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => localStorage.setItem("theme", value), theme);
      await page.reload();
      await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      expect(await page.locator("html").evaluate((html) => html.classList.contains("dark"))).toBe(theme === "dark");
    }
  });
}
