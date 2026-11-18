import { copyFile, mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import electron from "electron";

const mode = process.argv[2];
const root = process.cwd();
const stage = resolve("dist/desktop-stage");
const manifest = JSON.parse(await readFile("package.json", "utf8"));
const pnpmPath = process.env.npm_execpath;
if (!pnpmPath) throw Error("Run this script through pnpm.");
function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error(command + " exited with " + code)),
    );
  });
}
await run(process.execPath, ["scripts/build.mjs", "desktop"]);
await mkdir(resolve(stage, "dist"), { recursive: true });
await writeFile(
  resolve(stage, "package.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
for (const filename of ["pnpm-lock.yaml", "pnpm-workspace.yaml"])
  await copyFile(filename, resolve(stage, filename));
await rm(resolve(stage, "dist", "web"), { recursive: true, force: true });
for (const filename of ["desktop.mjs", "utility.cjs", "web"])
  await cp(resolve("dist", filename), resolve(stage, "dist", filename), {
    recursive: true,
  });
await run(
  process.execPath,
  [pnpmPath, "install", "--prod", "--frozen-lockfile", "--ignore-scripts"],
  stage,
);
const builder = resolve("node_modules/electron-builder/cli.js");
const config = resolve("electron-builder.yml");
if (mode === "dev") {
  await run(process.execPath, [
    builder,
    "install-app-deps",
    "--projectDir",
    stage,
    "--config",
    config,
  ]);
  await run(electron, [stage]);
} else {
  await run(process.execPath, [
    builder,
    "--projectDir",
    stage,
    "--config",
    config,
    "--config.directories.output=" + resolve("release"),
    "--publish",
    "never",
    ...process.argv.slice(3),
  ]);
}
