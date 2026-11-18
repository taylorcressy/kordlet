import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { atomicWrite } from "../service/paths";
import { createHash } from "node:crypto";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const skills = ["plan", "work", "review", "handoff", "triage"];
export function bootstrap(
  root: string,
  source: string,
  tool: string,
  dryRun: boolean,
  remove: boolean,
  command?: string[],
) {
  const destinations: Record<string, string> = {
    codex: ".agents/skills",
    claude: ".claude/skills",
    generic: ".kordlet/skills",
  };
  if (!Object.hasOwn(destinations, tool))
    throw Error("Choose codex, claude, or generic.");
  const manifest = ".kordlet/" + tool + "-skills.json";
  const journal = ".kordlet/" + tool + "-journal.json";
  const configuration =
    tool === "codex"
      ? ".codex/config.toml"
      : tool === "claude"
        ? ".mcp.json"
        : undefined;
  const key = "@mcp";
  const start = "# BEGIN Kordlet MCP";
  const end = "# END Kordlet MCP";
  const safe = (name: string) => {
    const path = resolve(root, name);
    const rel = relative(root, path);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      throw Error("Unsafe installation path.");
    let ancestor = path;
    while (ancestor !== root) {
      try {
        if (lstatSync(ancestor).isSymbolicLink())
          throw Error("Symlink in installation path: " + ancestor);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      ancestor = dirname(ancestor);
    }
    return path;
  };
  const read = (name: string) =>
    existsSync(safe(name)) ? readFileSync(safe(name), "utf8") : null;
  const allowed = skills.map(
    (name) => destinations[tool] + "/kordlet-" + name + "/SKILL.md",
  );
  const original = read(manifest);
  const previous = JSON.parse(original ?? "{}") as Record<string, string>;
  if (
    Object.keys(previous).some(
      (name) => !allowed.includes(name) && name !== key,
    )
  )
    throw Error("Unexpected manifest entry.");
  const writes: {
    name: string;
    before: string | null;
    after: string | null;
  }[] = [];
  const next: Record<string, string> = {};
  const pending = read(journal);
  if (pending)
    throw Error(
      "An interrupted setup has a recovery journal at " +
        safe(journal) +
        ". Restore its before values or finish its after values, then remove the journal and rerun.",
    );
  for (const [index, name] of allowed.entries()) {
    const before = read(name);
    if (before !== null && digest(before) !== previous[name])
      throw Error("Local file conflicts with managed skill: " + name);
    const after = remove
      ? null
      : readFileSync(
          join(source, "kordlet-" + skills[index], "SKILL.md"),
          "utf8",
        );
    if (after !== null) next[name] = digest(after);
    if (before !== after) writes.push({ name, before, after });
  }
  if (configuration && (command || previous[key])) {
    const before = read(configuration);
    let after: string | null;
    if (tool === "codex") {
      const data = before ?? "";
      const from = data.indexOf(start);
      const to = data.indexOf(end);
      if (from < 0 !== to < 0 || (to >= 0 && to < from))
        throw Error("Invalid Kordlet MCP block.");
      const current = from < 0 ? null : data.slice(from, to + end.length);
      if (current && digest(current) !== previous[key])
        throw Error("Local change conflicts with the managed MCP block.");
      if (
        !current &&
        /^[ \t]*\[mcp_servers\.(?:kordlet|"kordlet"|'kordlet')\]/m.test(data)
      )
        throw Error("A Kordlet MCP entry already exists.");
      const entry =
        remove || !command
          ? null
          : [
              start,
              "[mcp_servers.kordlet]",
              "command = " + JSON.stringify(command[0]),
              "args = " + JSON.stringify(command.slice(1)),
              end,
            ].join("\n");
      if (entry) next[key] = digest(entry);
      after = current
        ? data.replace(current, entry ?? "")
        : entry
          ? data + (data && !data.endsWith("\n") ? "\n" : "") + entry + "\n"
          : before;
      if (after !== null && !after.trim()) after = null;
    } else {
      const data = JSON.parse(before ?? "{}") as {
        mcpServers?: Record<string, unknown>;
      };
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        (data.mcpServers !== undefined &&
          (!data.mcpServers ||
            typeof data.mcpServers !== "object" ||
            Array.isArray(data.mcpServers)))
      )
        throw Error("Invalid Claude MCP configuration.");
      const current = data.mcpServers?.kordlet;
      if (
        current !== undefined &&
        digest(JSON.stringify(current)) !== previous[key]
      )
        throw Error("Local change conflicts with the managed MCP entry.");
      if (!remove && command) {
        const entry = { command: command[0], args: command.slice(1) };
        (data.mcpServers ??= {}).kordlet = entry;
        next[key] = digest(JSON.stringify(entry));
      } else if (current !== undefined && data.mcpServers) {
        delete data.mcpServers.kordlet;
        if (!Object.keys(data.mcpServers).length) delete data.mcpServers;
      }
      after = Object.keys(data).length
        ? JSON.stringify(data, null, 2) + "\n"
        : null;
      if (
        current !== undefined &&
        JSON.stringify(data.mcpServers?.kordlet) === JSON.stringify(current)
      )
        after = before;
    }
    if (after !== before) writes.push({ name: configuration, before, after });
  }
  const newManifest = remove ? null : JSON.stringify(next, null, 2) + "\n";
  if (original !== newManifest)
    writes.push({ name: manifest, before: original, after: newManifest });
  if (!dryRun && writes.length) {
    mkdirSync(dirname(safe(journal)), { recursive: true, mode: 0o700 });
    atomicWrite(safe(journal), JSON.stringify(writes, null, 2));
    for (const item of writes) {
      if (read(item.name) !== item.before)
        throw Error("Concurrent change: " + item.name);
      if (item.after === null) rmSync(safe(item.name));
      else {
        mkdirSync(dirname(safe(item.name)), { recursive: true });
        atomicWrite(safe(item.name), item.after);
      }
    }
    rmSync(safe(journal));
  }
  return {
    tool,
    dryRun,
    files: writes.map((w) => w.name),
    ...(dryRun
      ? { changes: writes.map(({ name, after }) => ({ name, after })) }
      : {}),
    installed: allowed.filter((name) => read(name) !== null),
  };
}
export function findMarker(start: string) {
  let current = resolve(start);
  while (true) {
    const file = join(current, ".kordlet-project.json");
    if (existsSync(file) && !lstatSync(file).isSymbolicLink()) {
      const data = JSON.parse(readFileSync(file, "utf8"));
      if (data.version === 1 && typeof data.projectId === "string")
        return data.projectId as string;
      throw Error("Invalid project marker.");
    }
    if (readdirSync(current).includes(".git") || dirname(current) === current)
      return undefined;
    current = dirname(current);
  }
}
