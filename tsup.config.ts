import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/cli/main.ts", "src/index.ts"],
  format: ["esm"],
  target: "node22",
});
