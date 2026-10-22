// `npm run build`: bundles the bot (with the pieces of ../src/lib it uses)
// into dist/, so the VM only needs dist/, package.json and `npm ci --omit=dev`.
import { build } from "esbuild";

await build({
  entryPoints: { main: "src/main.ts", link: "src/link.ts", cli: "src/cli.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: true,
  logLevel: "info",
});
