import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const shared = fileURLToPath(new URL("./packages/shared/src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@wabbr/shared": `${shared}/index.ts`,
    },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    environment: "node",
  },
});
