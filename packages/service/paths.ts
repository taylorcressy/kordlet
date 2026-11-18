import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  mkdirSync,
  realpathSync,
  readFileSync,
  renameSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { product } from "../contracts";
export function dataDirectory() {
  const base =
    process.platform === "win32"
      ? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : (process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"));
  return resolve(process.env.KORDLET_DATA_DIR ?? join(base, product.cli));
}
export function canonicalDirectory() {
  const dir = dataDirectory();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return realpathSync.native(dir);
}
export function atomicWrite(path: string, value: string) {
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    writeFileSync(temporary, value, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
export type Runtime = {
  endpoint: string;
  instance: string;
  directory: string;
  api: string;
  contract: string;
  pid: number;
  startedAt: string;
  mode: "desktop" | "headless";
};
export async function discover(): Promise<Runtime> {
  const dir = realpathSync.native(dataDirectory());
  const runtime = JSON.parse(
    readFileSync(join(dir, "runtime.json"), "utf8"),
  ) as Runtime;
  const endpoint = new URL(runtime.endpoint);
  if (
    endpoint.protocol !== "http:" ||
    endpoint.hostname !== "127.0.0.1" ||
    !endpoint.port ||
    endpoint.origin !== runtime.endpoint ||
    runtime.directory !== dir
  )
    throw Error("Invalid runtime identity.");
  const response = await fetch(runtime.endpoint + "/health", {
    signal: AbortSignal.timeout(1500),
    redirect: "error",
  });
  const health = (await response.json()) as Runtime;
  if (
    !response.ok ||
    health.instance !== runtime.instance ||
    health.api !== product.api ||
    health.contract !== product.contract ||
    health.startedAt !== runtime.startedAt ||
    health.directory !== dir
  )
    throw Error("Incompatible service identity.");
  return runtime;
}
