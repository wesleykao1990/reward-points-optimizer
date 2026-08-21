import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      "@jro/contracts": fileURLToPath(
        new URL("../contracts/src/index.ts", import.meta.url),
      ),
    },
  },
});
