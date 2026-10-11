import { defineConfig, devices } from "@playwright/test";

// Run with `corepack pnpm test:e2e` — the wrapper starts the emulators first.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  // Reduced motion keeps the staged reveals short; behaviour is otherwise identical.
  use: { baseURL: "http://127.0.0.1:5174", trace: "retain-on-failure", screenshot: "only-on-failure", contextOptions: { reducedMotion: "reduce" } },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"] }, grepInvert: /dealer/ },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 } }, grep: /dealer/ },
  ],
  webServer: {
    command: "corepack pnpm --filter @fortuna/web exec vite --port 5174 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:5174",
    env: { VITE_USE_EMULATORS: "1" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
