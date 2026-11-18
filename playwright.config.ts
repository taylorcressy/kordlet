import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: {
    viewport: { width: 1512, height: 940 },
    launchOptions: { executablePath: process.env.KORDLET_CHROME },
  },
});
