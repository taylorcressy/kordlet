import { extract } from "tar";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import assert from "node:assert/strict";
const run = promisify(execFile);
const pnpm = process.env.npm_execpath;
if (!pnpm) throw Error("Run through pnpm.");
const root = await mkdtemp(join(tmpdir(), "Kordlet Node smoke ü "));
const data = join(root, "data");
const application = join(root, "app");
const env = { ...process.env, KORDLET_DATA_DIR: data };
delete env.KORDLET_TOKEN;
let service;
try {
  await mkdir(application);
  await extract({
    file: resolve("release/kordlet-node.tar.gz"),
    cwd: application,
  });
  await run(
    process.execPath,
    [pnpm, "install", "--prod", "--frozen-lockfile"],
    { cwd: application, env },
  );
  service = spawn(process.execPath, ["dist/server.mjs"], {
    cwd: application,
    env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [output] = await Promise.race([
    once(service.stdout, "data"),
    once(service, "exit").then(() => {
      throw Error("Node service exited during startup.");
    }),
  ]);
  const endpoint = new URL(String(output).trim()).origin;
  const home = await fetch(endpoint);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Kordlet/);
  const { stdout } = await run(
    process.execPath,
    [
      "dist/kordlet.mjs",
      "project",
      "create",
      "--input",
      '{"name":"Node smoke","prefix":"NODE"}',
      "--json",
    ],
    { cwd: application, env },
  );
  assert.equal(JSON.parse(stdout).prefix, "NODE");
  console.log(
    "Extracted Node distribution: clean production install, local web service, and separate CLI passed.",
  );
} finally {
  if (service?.exitCode === null) {
    const done = once(service, "exit");
    service.kill();
    await done;
  }
  await rm(root, { recursive: true, force: true });
}
