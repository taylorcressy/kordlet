import { cp, mkdir, rm } from "node:fs/promises";
import { create } from "tar";
import { spawn } from "node:child_process";
const stage = "dist/node-distribution";
await new Promise((resolve, reject) => {
  const processChild = spawn(process.execPath, ["scripts/build.mjs", "web"], {
    stdio: "inherit",
  });
  processChild.once("error", reject);
  processChild.once("exit", (code) =>
    code === 0 ? resolve() : reject(Error("Web build failed.")),
  );
});
await mkdir(stage + "/dist", { recursive: true });
await mkdir("release", { recursive: true });
for (const file of [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "README.md",
  "LICENSE",
])
  await cp(file, stage + "/" + file);
await rm(stage + "/dist/web", { recursive: true, force: true });
for (const file of ["server.mjs", "kordlet.mjs", "web", "skills"])
  await cp("dist/" + file, stage + "/dist/" + file, { recursive: true });
await cp("docs/development/setup.md", stage + "/INSTALL.md");
await create(
  {
    gzip: true,
    file: "release/kordlet-node.tar.gz",
    cwd: stage,
    portable: true,
  },
  [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "LICENSE",
    "INSTALL.md",
    "dist",
  ],
);
