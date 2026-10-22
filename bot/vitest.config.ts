import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // test/links.test.ts imports the app's src/lib to compare outputs.
    alias: { "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
