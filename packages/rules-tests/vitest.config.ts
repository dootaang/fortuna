import { defineConfig } from "vitest/config";

// Runs against the Firestore/Auth emulators started by `pnpm test:rules`.
export default defineConfig({
  test: { environment: "node", testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false, sequence: { concurrent: false } },
});
