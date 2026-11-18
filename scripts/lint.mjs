import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
const restrictions = {
  "packages/contracts": ["apps", "packages/client", "packages/service"],
  "packages/client": ["apps", "packages/service"],
  "apps/web": [
    "packages/service",
    "apps/server",
    "apps/desktop",
    "apps/cli",
    "apps/mcp",
  ],
  "apps/mcp": ["packages/service", "apps/server"],
};
for (const [directory, denied] of Object.entries(restrictions)) {
  for (const file of await readdir(directory, { recursive: true })) {
    if (!/\.tsx?$/.test(String(file))) continue;
    const path = resolve(directory, String(file));
    const source = await readFile(path, "utf8");
    for (const [, specifier] of source.matchAll(
      /(?:from\s+|import\s*\()['"]([^'"]+)/g,
    )) {
      if (!specifier.startsWith(".")) continue;
      const target = relative(
        process.cwd(),
        resolve(dirname(path), specifier),
      ).replaceAll("\\", "/");
      if (
        denied.some(
          (prefix) => target === prefix || target.startsWith(prefix + "/"),
        )
      ) {
        console.error(relative(process.cwd(), path) + " depends on " + target);
        process.exitCode = 1;
      }
    }
  }
}
