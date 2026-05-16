import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    // testcontainers can take 60-90s on first run (image pull + migrate)
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
