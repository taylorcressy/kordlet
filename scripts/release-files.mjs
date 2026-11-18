import { createReadStream } from "node:fs";
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
const directory = "release/distribution";
await mkdir(directory, { recursive: true });
for (const file of await readdir("release")) {
  if (/\.(AppImage|dmg|zip|exe|tar\.gz)$/.test(file))
    await cp(join("release", file), join(directory, file));
}
const lines = [];
for (const file of (await readdir(directory)).sort()) {
  if (file === "SHA256SUMS") continue;
  const hash = createHash("sha256");
  await pipeline(createReadStream(join(directory, file)), hash);
  lines.push(hash.digest("hex") + "  " + file);
}
if (!lines.length) throw Error("No release artifacts.");
await writeFile(join(directory, "SHA256SUMS"), lines.join("\n") + "\n");
