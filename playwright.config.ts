import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://127.0.0.1:3101",
    browserName: "chromium",
    launchOptions: {
      executablePath:
        process.env.CHROMIUM_PATH ||
        (process.env.CI ? undefined : "/usr/bin/chromium"),
      args: ["--no-sandbox"],
    },
    trace: "retain-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
  webServer: {
    command: "npm run start",
    url: "http://127.0.0.1:3101/api/health",
    reuseExistingServer: false,
    env: {
      PORT: "3101",
      HOST: "127.0.0.1",
      DB_PATH: "./data/browser-test.sqlite",
      OPENAI_API_KEY: "",
      DISCONNECT_GRACE_MS: "500",
    },
  },
});
