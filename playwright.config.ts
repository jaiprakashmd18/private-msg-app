import { defineConfig } from "@playwright/test";

const browser = process.env.PLAYWRIGHT_BROWSER;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: {
    baseURL: process.env.APP_URL || "http://127.0.0.1:3000",
    browserName: browser === "firefox" || browser === "webkit" ? browser : "chromium",
    launchOptions: executablePath ? { executablePath } : undefined,
    screenshot: "only-on-failure",
  },
});
