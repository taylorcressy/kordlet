import { readFileSync, existsSync, writeFileSync, realpathSync } from "node:fs";
import { join, basename, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { parseArgs } from "node:util";
import { validInput } from "../../packages/contracts/validation";
import {
  entries,
  commandName,
  product,
  type Operation,
} from "../../packages/contracts";
import { apiClient, ApiError } from "../../packages/client";
import {
  discover,
  dataDirectory,
  atomicWrite,
} from "../../packages/service/paths";
import { serve } from "../server/serve";
import { runMcp } from "../mcp";
import { bootstrap, findMarker } from "../../packages/agent-kit";
const options = {
  json: { type: "boolean" },
  input: { type: "string" },
  project: { type: "string" },
  "idempotency-key": { type: "string" },
  tool: { type: "string" },
  scope: { type: "string" },
  "dry-run": { type: "boolean" },
  remove: { type: "boolean" },
  profile: { type: "string" },
  help: { type: "boolean" },
} as const;
const invalid = (message: string) =>
  new ApiError({
    code: "invalid_input",
    message,
    requestId: "client",
    retryable: false,
  });
const tokenFile = () => join(dataDirectory(), "owner.token");
async function connection(profile?: string) {
  try {
    if (profile && !/^[a-zA-Z0-9_-]+$/.test(profile))
      throw invalid("Invalid credential profile name.");
    const runtime = await discover();
    const token = profile
      ? readFileSync(
          join(dataDirectory(), "profile-" + profile + ".token"),
          "utf8",
        )
      : (process.env.KORDLET_TOKEN ?? readFileSync(tokenFile(), "utf8"));
    return { runtime, token, call: apiClient(runtime.endpoint, token) };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError({
      code: "service_unavailable",
      message:
        "Service or credential unavailable. Start with kordlet serve and check your profile.",
      requestId: "client",
      retryable: true,
    });
  }
}
const output = (value: unknown) => console.log(JSON.stringify(value, null, 2));
async function resolveProject(
  call: ReturnType<typeof apiClient>,
  explicit?: string,
) {
  if (explicit) return explicit;
  const cwd = realpathSync.native(process.cwd());
  let cursor: number | undefined;
  const matches: { id: string; path: string }[] = [];
  do {
    const page = await call("project.list", { cursor, limit: 100 });
    for (const project of page.items) {
      if (project.archived || !project.repository) continue;
      try {
        const path = realpathSync.native(project.repository);
        const pathRelative = relative(path, cwd);
        if (
          !isAbsolute(pathRelative) &&
          pathRelative.split(/[\\/]/)[0] !== ".."
        )
          matches.push({ id: project.id, path });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    cursor = page.cursor ?? undefined;
  } while (cursor !== undefined);
  matches.sort((a, b) => b.path.length - a.path.length);
  if (matches[0] && matches[0].path === matches[1]?.path)
    throw invalid("Multiple projects match this repository. Use --project.");
  return matches[0]?.id ?? findMarker(cwd) ?? process.env.KORDLET_PROJECT;
}
async function main() {
  const { values, positionals } = parseArgs({
    options,
    allowPositionals: true,
  });
  const [first, second, third] = positionals;
  if (!first || first === "help" || values.help) {
    output({
      name: product.cli,
      commands: entries.map(([id]) => commandName(id)),
      lifecycle: [
        "serve",
        "open",
        "mcp",
        "init",
        "bootstrap",
        "doctor",
        "backup",
        "restore",
      ],
    });
    return;
  }
  if (first === "serve") {
    const service = await serve();
    console.log(service.mintLaunch());
    for (const signal of ["SIGTERM", "SIGINT"] as const)
      process.once(signal, () => void service.close());
    return;
  }
  if (first === "mcp") {
    await runMcp(async () => (await connection(values.profile)).call);
    return;
  }
  if (first === "open") {
    const { runtime, token } = await connection(values.profile);
    const response = await fetch(runtime.endpoint + "/session/launch", {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
    });
    if (!response.ok)
      throw invalid("An owner credential is required to open the browser.");
    const { url } = (await response.json()) as { url: string };
    if (values.json) {
      output({ url });
      return;
    }
    console.log(url);
    if (process.platform === "darwin") execFile("open", [url], () => {});
    else if (process.platform === "linux")
      execFile("xdg-open", [url], () => {});
    else if (process.platform === "win32")
      execFile("explorer.exe", [url], () => {});
    return;
  }
  if (first === "backup" || first === "restore") {
    if (!second || third)
      throw invalid("Usage: kordlet " + first + " <database-file>");
    const { maintain } = await import("../../packages/service/maintenance");
    output(await maintain(first, resolve(second)));
    return;
  }
  if (first === "doctor") {
    const { runtime, call } = await connection(values.profile);
    await call("workspace.instructions", {});
    output({
      service: runtime.endpoint,
      api: runtime.api,
      contract: runtime.contract,
      projectId: (await resolveProject(call, values.project)) ?? null,
      mcp: "kordlet mcp",
    });
    return;
  }
  if (first === "init") {
    const { call } = await connection(values.profile);
    const marker = resolve(".kordlet-project.json");
    if (existsSync(marker))
      throw invalid("This directory already has a project marker.");
    const name = basename(process.cwd());
    const prefix = (second ?? name.replace(/[^a-z0-9]/gi, "").slice(0, 8))
      .toUpperCase()
      .padEnd(2, "X");
    const project = await call("project.create", {
      name,
      prefix,
      repository: process.cwd(),
    });
    writeFileSync(
      marker,
      JSON.stringify({ version: 1, projectId: project.id }, null, 2) + "\n",
      { flag: "wx" },
    );
    output(project);
    return;
  }
  if (first === "bootstrap") {
    if (values.scope && values.scope !== "project")
      throw invalid("Only project scope is supported.");
    const tool = values.tool ?? "generic";
    const root = process.cwd();
    const source = fileURLToPath(new URL("./skills", import.meta.url));
    const launch = [process.execPath, fileURLToPath(import.meta.url), "mcp"];
    const current = values.project ?? findMarker(root);
    let profile = current;
    if (!values["dry-run"] && !values.remove) {
      const { call } = await connection();
      profile = await resolveProject(call, values.project);
      if (!profile)
        throw invalid("Specify --project or run kordlet init first.");
      if (!/^[a-zA-Z0-9_-]+$/.test(profile))
        throw invalid("Invalid project ID.");
      bootstrap(root, source, tool, true, false, [
        ...launch,
        "--profile",
        profile,
      ]);
      const path = join(dataDirectory(), "profile-" + profile + ".token");
      if (!existsSync(path)) {
        const result = await call("credential.create", {
          projectId: profile,
          kind: "agent",
        });
        atomicWrite(path, result.token);
      } else {
        try {
          await (
            await connection(profile)
          ).call("project.get", { projectId: profile });
        } catch (error) {
          if (
            !(error instanceof ApiError) ||
            error.failure.code !== "unauthorized"
          )
            throw error;
          const result = await call("credential.create", {
            projectId: profile,
            kind: "agent",
          });
          atomicWrite(path, result.token);
        }
      }
    }
    const command = [...launch, "--profile", profile ?? "<project-id>"];
    const result = bootstrap(
      root,
      source,
      tool,
      Boolean(values["dry-run"]),
      Boolean(values.remove),
      command,
    );
    output({ ...result, command });
    return;
  }
  const id =
    first === "api" && second === "call"
      ? third
      : entries.find(
          ([operation]) => commandName(operation) === [first, second].join(" "),
        )?.[0];
  const operation = entries.find(([candidate]) => candidate === id);
  if (
    !operation ||
    (first === "api" ? positionals.length !== 3 : positionals.length !== 2)
  )
    throw invalid("Unknown command. Run kordlet help.");
  const [name, meta] = operation;
  if (values.tool || values.scope || values["dry-run"] || values.remove)
    throw invalid("Bootstrap flags are unavailable for domain commands.");
  const input = values.input
    ? JSON.parse(
        values.input === "-"
          ? readFileSync(0, "utf8")
          : values.input.startsWith("@")
            ? readFileSync(values.input.slice(1), "utf8")
            : values.input,
      )
    : {};
  if (
    input &&
    typeof input === "object" &&
    "projectId" in meta.input.properties &&
    !Object.hasOwn(input, "projectId")
  ) {
    const project =
      values.project ??
      (await resolveProject((await connection(values.profile)).call));
    if (project) input.projectId = project;
  } else if (
    values.project &&
    (!input || typeof input !== "object" || input.projectId !== values.project)
  )
    throw invalid(
      "--project does not apply to this operation or conflicts with explicit input.",
    );
  if (!validInput(name, input))
    throw invalid(
      "Input does not match " + name + ". See generated/operations.json.",
    );
  const { call } = await connection(values.profile);
  const result = await call(
    name as Operation,
    input,
    values["idempotency-key"],
  );
  output(result);
}
main().catch((error) => {
  const failure =
    error instanceof ApiError
      ? error.failure
      : {
          code: "command_failed",
          message: error instanceof Error ? error.message : String(error),
          requestId: "client",
          retryable: false,
        };
  if (process.argv.includes("--json")) output({ error: failure });
  else console.error(failure.message);
  process.exitCode = failure.retryable ? 3 : 1;
});
