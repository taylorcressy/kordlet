import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["scripts/generate.ts"],
  outfile: "dist/generate.mjs",
  bundle: true,
  platform: "node",
  packages: "external",
  format: "esm",
});
await import("../dist/generate.mjs");
