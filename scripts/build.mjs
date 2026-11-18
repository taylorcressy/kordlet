import { build } from "esbuild";
import { build as vite } from "vite";
import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const target = process.argv[2] ?? "all";
const included = (...targets) => target === "all" || targets.includes(target);
const server = (entry, outfile, options = {}) =>
  build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    target: "node22",
    ...options,
  });
await mkdir("dist", { recursive: true });
if (included("web", "desktop")) {
  await vite({
    root: "apps/web",
    build: {
      outDir: resolve("dist/web"),
      emptyOutDir: true,
      license: { fileName: "THIRD-PARTY-LICENSES.md" },
    },
  });
}
if (included("web", "cli", "mcp"))
  await server("apps/server/index.ts", "dist/server.mjs");
if (included("cli", "mcp", "web")) {
  await server("apps/cli/index.ts", "dist/kordlet.mjs", {
    banner: { js: "#!/usr/bin/env node" },
  });
  await cp("skills", "dist/skills", { recursive: true });
}
if (included("desktop")) {
  await server("apps/desktop/main.ts", "dist/desktop.mjs");
  await server("apps/desktop/utility.ts", "dist/utility.cjs", {
    format: "cjs",
  });
}
