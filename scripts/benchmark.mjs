import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
const directory = await mkdtemp(join(tmpdir(), "kordlet benchmark "));
const start = performance.now();
const child = spawn(process.execPath, ["dist/server.mjs"], {
  env: { ...process.env, KORDLET_DATA_DIR: directory },
  stdio: ["ignore", "pipe", "inherit"],
});
try {
  const [output] = await Promise.race([
    once(child.stdout, "data"),
    once(child, "exit").then(() => {
      throw Error("Service exited during startup.");
    }),
  ]);
  const coldMs = performance.now() - start;
  const endpoint = new URL(String(output).trim()).origin;
  const token = await readFile(join(directory, "owner.token"), "utf8");
  const headers = {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  };
  async function request(path, body) {
    const response = await fetch(endpoint + "/api/v1" + path, {
      headers,
      method: body ? "POST" : "GET",
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw Error(JSON.stringify(await response.json()));
    return response.json();
  }
  const project = await request("/projects", {
    name: "Benchmark workspace",
    prefix: "BENCH",
  });
  for (let i = 0; i < 10000; i += 8)
    await Promise.all(
      Array.from({ length: 8 }, (_, offset) =>
        request("/projects/" + project.id + "/issues", {
          title: "Benchmark issue " + (i + offset),
          description:
            "Acceptance and implementation notes for issue " + (i + offset),
        }),
      ),
    );
  const times = [];
  for (let i = 0; i < 128; i += 8)
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        const time = performance.now();
        await request(
          "/issues?projectId=" + project.id + "&search=Benchmark&limit=50",
        );
        times.push(performance.now() - time);
      }),
    );
  times.sort((a, b) => a - b);
  let rssKiB = null;
  if (process.platform === "linux")
    rssKiB = Number(
      (await readFile("/proc/" + child.pid + "/status", "utf8")).match(
        /^VmRSS:\s*(\d+)/m,
      )?.[1],
    );
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        issues: 10000,
        concurrency: 8,
        coldMs: Math.round(coldMs),
        listP50Ms: Math.round(times[64]),
        listP95Ms: Math.round(times[121]),
        rssKiB,
      },
      null,
      2,
    ),
  );
} finally {
  if (child.exitCode === null) {
    const done = once(child, "exit");
    child.kill();
    await done;
  }
  await rm(directory, { recursive: true, force: true });
}
