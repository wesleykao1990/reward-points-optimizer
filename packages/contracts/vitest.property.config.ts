import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.property.test.ts"],
    pool: "forks",
    passWithNoTests: false,
  },
});
