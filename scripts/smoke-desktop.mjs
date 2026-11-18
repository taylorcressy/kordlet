import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";

const executablePath = resolve(
  process.argv[2] ?? "release/linux-unpacked/kordlet",
);
const directory = await mkdtemp(join(tmpdir(), "Kordlet packaged ü "));
const env = { ...process.env, KORDLET_DATA_DIR: directory };
const cli = resolve("dist/kordlet.mjs");
const execute = promisify(execFile);
const cliCall = async (operation, input) =>
  JSON.parse(
    (
      await execute(
        process.execPath,
        [
          cli,
          "api",
          "call",
          operation,
          "--input",
          JSON.stringify(input),
          "--json",
        ],
        { env },
      )
    ).stdout,
  );
let app;
let server;
async function launch() {
  app = await electron.launch({
    executablePath,
    env,
    args: [],
    timeout: 20000,
  });
  const page = await app.firstWindow({ timeout: 15000 });
  await page.getByRole("heading", { name: "Boardroom" }).waitFor();
  return page;
}
try {
  const first = await launch();
  await first
    .getByRole("heading", { name: "Create your first project" })
    .waitFor();
  const project = await cliCall("project.create", {
    name: "Packaged smoke",
    prefix: "PKG",
  });
  const issue = await cliCall("issue.create", {
    projectId: project.id,
    title: "Persists across desktop restart",
  });
  assert.equal(issue.key, "PKG-1");
  await app.close();
  app = undefined;
  await assert.rejects(readFile(join(directory, "runtime.json")));
  const second = await launch();
  await second
    .getByRole("button", { name: /Persists across desktop restart/ })
    .waitFor();
  assert.equal(
    (await cliCall("issue.get", { issueId: issue.id })).title,
    issue.title,
  );
  await app.close();
  app = undefined;

  server = spawn(process.execPath, [cli, "serve"], {
    env,
    stdio: ["ignore", "pipe", "inherit"],
  });
  await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(() => {
      throw Error("Headless service failed to start.");
    }),
  ]);
  const headless = JSON.parse(
    await readFile(join(directory, "runtime.json"), "utf8"),
  );
  const attached = await launch();
  await attached
    .getByRole("button", { name: /Persists across desktop restart/ })
    .waitFor();
  await app.close();
  app = undefined;
  const remaining = JSON.parse(
    await readFile(join(directory, "runtime.json"), "utf8"),
  );
  assert.equal(remaining.instance, headless.instance);
  assert.equal(
    (await cliCall("issue.get", { issueId: issue.id })).key,
    "PKG-1",
  );
  console.log(
    "Packaged desktop: SQLite write/read/restart, CLI connection, owned shutdown and headless attach passed.",
  );
} finally {
  await app?.close();
  if (server?.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}
