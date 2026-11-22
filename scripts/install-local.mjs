import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const pnpm = process.env.npm_execpath;
if (!pnpm) throw Error("Run this script through pnpm.");
const env = { ...process.env };
const bin = execFileSync(process.execPath, [pnpm, "bin", "--global"], {
  encoding: "utf8",
}).trim();
if (!bin) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const prefix = execFileSync(npm, ["prefix", "--global"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  }).trim();
  const fallback = process.platform === "win32" ? prefix : join(prefix, "bin");
  const normalize = (dir) =>
    process.platform === "win32" ? resolve(dir).toLowerCase() : resolve(dir);
  if (!env.PATH?.split(delimiter).some((dir) => normalize(dir) === normalize(fallback))) {
    throw Error("Run pnpm setup and open a new terminal to add pnpm's bin directory to PATH.");
  }
  mkdirSync(fallback, { recursive: true });
  env.npm_config_global_bin_dir = fallback;
}
const args = process.argv[2] === "remove"
  ? ["remove", "--global", "kordlet"]
  : ["link", "--global"];
const result = spawnSync(process.execPath, [pnpm, ...args], { env, stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
