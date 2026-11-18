import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { validate } from "@scalar/openapi-parser";
import SQLite from "better-sqlite3";
import { startService } from "../packages/service/http";
import { apiClient, ApiError } from "../packages/client";
import {
  entries,
  commandName,
  toolName,
  type Input,
  type Output,
  type Operation,
} from "../packages/contracts";

const execute = promisify(execFile);
const cliPath = resolve("dist/kordlet.mjs");
const dir = mkdtempSync(join(tmpdir(), "kordlet parity ü "));
const previous = process.env.KORDLET_DATA_DIR;
process.env.KORDLET_DATA_DIR = dir;
let service: Awaited<ReturnType<typeof startService>>;
let call: ReturnType<typeof apiClient>;
let sdk: Client;
let cliEnv: NodeJS.ProcessEnv;
let ownerToken: string;
beforeAll(async () => {
  service = await startService({ mode: "headless" });
  ownerToken = readFileSync(join(dir, "owner.token"), "utf8");
  call = apiClient(service.runtime.endpoint, ownerToken);
  cliEnv = { ...process.env, KORDLET_DATA_DIR: dir, KORDLET_TOKEN: ownerToken };
  sdk = new Client({ name: "parity-test", version: "1" });
  await sdk.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [cliPath, "mcp"],
      env: cliEnv as Record<string, string>,
    }),
  );
});
afterAll(async () => {
  await sdk?.close();
  await service?.close();
  rmSync(dir, { force: true, recursive: true });
  if (previous === undefined) delete process.env.KORDLET_DATA_DIR;
  else process.env.KORDLET_DATA_DIR = previous;
});
test("actual adapter inventories match the canonical registry", async () => {
  const { stdout } = await execute(process.execPath, [cliPath, "help"], {
    env: cliEnv,
  });
  expect(JSON.parse(stdout).commands.sort()).toEqual(
    entries.map(([id]) => commandName(id)).sort(),
  );
  expect((await sdk.listTools()).tools.map((t) => t.name).sort()).toEqual(
    entries.map(([id]) => toolName(id)).sort(),
  );
  const lifecycle = [
    "GET /health",
    "POST /session/launch",
    "POST /session",
    "GET /stream",
  ];
  expect([...service.routes].sort()).toEqual(
    [
      ...lifecycle,
      ...entries.map(([, meta]) => meta.method + " /api/v1" + meta.path),
    ].sort(),
  );
  const spec = JSON.parse(readFileSync("generated/openapi.json", "utf8"));
  const validation = await validate(spec);
  expect(validation.valid, JSON.stringify(validation.errors)).toBe(true);
  expect(
    Object.values(spec.paths)
      .flatMap((path) =>
        Object.values(path as Record<string, { operationId: string }>).map(
          (method) => method.operationId,
        ),
      )
      .sort(),
  ).toEqual(entries.map(([id]) => id).sort());
});
test("REST, CLI subprocess and MCP SDK round-trip equivalent isolated projects", async () => {
  const seen = new Set<Operation>();
  type Invoke = <K extends Operation>(
    op: K,
    input: Input<K>,
    token?: string,
  ) => Promise<Output<K>>;
  async function scenario(prefix: string, transport: Invoke) {
    const invoke: Invoke = (op, input, token) => {
      seen.add(op);
      return transport(op, input, token);
    };
    const project = await invoke("project.create", {
      name: "Data & unicode ✓",
      prefix,
    });
    const projectId = project.id;
    expect(
      (await invoke("project.list", {})).items.some((p) => p.id === projectId),
    ).toBe(true);
    const changed = await invoke("project.update", {
      projectId,
      expectedRevision: 0,
      name: "Updated project",
    });
    expect(await invoke("project.get", { projectId })).toEqual(changed);
    expect((await invoke("workspace.instructions", {})).workflow).toContain(
      "Claim",
    );
    const actor = await invoke("credential.create", {
      projectId,
      kind: "agent",
    });
    const { token, credential } = actor;
    const input = {
      projectId,
      title: "Wire data ☃",
      labels: ["x"],
      criteria: ["Retain the full title"],
      assignee: null,
    };
    const issue = await invoke("issue.create", input);
    const issueId = issue.id;
    const edited = await invoke("issue.update", {
      issueId,
      expectedRevision: 0,
      description: "**Markdown**",
    });
    const result = await invoke("issue.list", {
      projectId,
      blocked: false,
      search: "Wire data",
      limit: 1,
    });
    expect(result.items).toEqual([edited]);
    const prerequisite = await invoke("issue.create", {
      projectId,
      title: "Prerequisite",
    });
    await invoke("dependency.add", { issueId, requiresId: prerequisite.id });
    const blocked = await invoke("issue.context", { issueId });
    expect(blocked).toMatchObject({
      issue: { blocked: true },
      dependencies: [{ title: "Prerequisite" }],
    });
    await invoke("dependency.remove", { issueId, requiresId: prerequisite.id });
    const complete = await invoke("issue.complete", {
      issueId: prerequisite.id,
      expectedRevision: 0,
    });
    expect(complete.status).toBe("Done");
    const archived = await invoke("issue.archive", {
      issueId: prerequisite.id,
      expectedRevision: complete.revision,
      archived: true,
    });
    expect(archived.archived).toBe(true);
    const unblocked = await invoke("issue.get", { issueId });
    await invoke("issue.transition", {
      issueId,
      expectedRevision: unblocked.revision,
      status: "Ready",
    });
    const localClaim = await invoke("issue.claim", { issueId });
    const transferred = await invoke("claim.reassign", {
      issueId,
      generation: localClaim.generation,
      actorId: credential.id,
      reason: "Transfer to scoped agent",
    });
    expect(transferred.generation).toBeGreaterThan(localClaim.generation);
    await invoke("claim.release", {
      issueId,
      generation: transferred.generation,
      reason: "Queue for pickup",
    });
    const claim = await invoke("issue.claimNext", { projectId }, token);
    expect(claim?.issueId).toBe(issueId);
    const generation = claim!.generation;
    expect(
      (await invoke("claim.heartbeat", { issueId, generation }, token))
        .generation,
    ).toBe(generation);
    await invoke(
      "comment.add",
      { issueId, generation, body: "Agent progress" },
      token,
    );
    expect((await invoke("comment.list", { issueId })).items[0].body).toBe(
      "Agent progress",
    );
    const current = await invoke("issue.get", { issueId });
    const review = await invoke(
      "review.submit",
      {
        issueId,
        generation,
        expectedRevision: current.revision,
        evidence: {
          summary: "Implemented",
          criteria: [current.criteria[0].id],
          checks: ["fixture check"],
          limitations: "",
          references: [],
        },
      },
      token,
    );
    expect(
      (await invoke("review.list", { projectId, pending: true })).items,
    ).toEqual([review]);
    const approved = await invoke("review.decide", {
      reviewId: review.id,
      decision: "approve",
      reason: "Verified evidence",
    });
    expect(approved.decision).toBe("approve");
    const final = await invoke("issue.context", { issueId });
    expect(final).toMatchObject({
      claim: null,
      issue: { status: "Done", criteria: [{ accepted: true }] },
    });
    expect((await invoke("credential.list", { projectId })).items).toEqual([
      credential,
    ]);
    expect(
      (
        await invoke("credential.revoke", {
          projectId,
          credentialId: credential.id,
        })
      ).revoked,
    ).toBe(true);
    const portable = await invoke("project.export", { projectId });
    const imported = await invoke("project.import", {
      name: "Imported",
      prefix: prefix + "IMP",
      data: portable,
    });
    expect(imported.remapped).toHaveLength(2);
    const events = await invoke("event.list", { projectId, limit: 100 });
    return {
      title: final.issue.title,
      description: final.issue.description,
      assignee: final.issue.assignee,
      labels: final.issue.labels,
      revision: final.issue.revision,
      audit: events.items.map((e) => e.operation),
      accepted: final.issue.criteria.map((c) => c.accepted),
    };
  }
  async function fresh<T>(
    run: (
      endpoint: string,
      env: Record<string, string>,
      owner: string,
    ) => Promise<T>,
  ) {
    const directory = mkdtempSync(join(tmpdir(), "kordlet adapter ü "));
    const previous = process.env.KORDLET_DATA_DIR;
    let instance: Awaited<ReturnType<typeof startService>> | undefined;
    try {
      process.env.KORDLET_DATA_DIR = directory;
      try {
        instance = await startService({ mode: "headless" });
      } finally {
        if (previous === undefined) delete process.env.KORDLET_DATA_DIR;
        else process.env.KORDLET_DATA_DIR = previous;
      }
      const owner = readFileSync(join(directory, "owner.token"), "utf8");
      const env = {
        ...cliEnv,
        KORDLET_DATA_DIR: directory,
        KORDLET_TOKEN: owner,
      } as Record<string, string>;
      seen.clear();
      const result = await run(instance.runtime.endpoint, env, owner);
      expect([...seen].sort()).toEqual(entries.map(([op]) => op).sort());
      return result;
    } finally {
      await instance?.close();
      rmSync(directory, { force: true, recursive: true });
    }
  }
  const http = await fresh((endpoint, _, owner) =>
    scenario("ADAPT", (op, input, token) =>
      apiClient(endpoint, token ?? owner)(op, input),
    ),
  );
  const cli = await fresh((_, env) =>
    scenario("ADAPT", async (op, input, token) => {
      const { stdout } = await execute(
        process.execPath,
        [
          cliPath,
          ...commandName(op).split(" "),
          "--input",
          JSON.stringify(input),
          "--json",
        ],
        { env: token ? { ...env, KORDLET_TOKEN: token } : env },
      );
      return JSON.parse(stdout);
    }),
  );
  const mcp = await fresh(async (_, env) => {
    const clients = new Map<string, Client>();
    try {
      return await scenario("ADAPT", async (op, input, token) => {
        const credential = token ?? env.KORDLET_TOKEN;
        let client = clients.get(credential);
        if (!client) {
          client = new Client({ name: "isolated-parity-test", version: "1" });
          clients.set(credential, client);
          await client.connect(
            new StdioClientTransport({
              command: process.execPath,
              args: [cliPath, "mcp"],
              env: { ...env, KORDLET_TOKEN: credential },
            }),
          );
        }
        const result = await client.callTool({
          name: toolName(op),
          arguments: input as Record<string, unknown>,
        });
        expect(result.isError, JSON.stringify(result.structuredContent)).toBe(
          false,
        );
        return (result.structuredContent as { result: never }).result;
      });
    } finally {
      await Promise.all([...clients.values()].map((client) => client.close()));
    }
  });
  expect(cli).toEqual(http);
  expect(mcp).toEqual(http);
}, 30000);
test("rejects unknown inputs, query coercion and updates with an old revision", async () => {
  const query = await fetch(
    service.runtime.endpoint + "/api/v1/issues?limit=1&limit=2",
    { headers: { Authorization: "Bearer " + ownerToken } },
  );
  expect((await query.json()).code).toBe("invalid_input");
  await expect(
    call("issue.list", { unknown: true } as never),
  ).rejects.toMatchObject({ failure: { code: "invalid_input" } });
  const mcp = await sdk.callTool({
    name: "issue_list",
    arguments: { limit: "1" },
  });
  expect(mcp.structuredContent).toMatchObject({
    error: { code: "invalid_input" },
  });
  await expect(
    execute(
      process.execPath,
      [cliPath, "issue", "list", "--input", '{"limit":"1"}', "--json"],
      { env: cliEnv },
    ),
  ).rejects.toMatchObject({ stdout: expect.stringContaining("invalid_input") });
  const p = await call("project.create", { name: "Revisions", prefix: "REV" });
  await call("project.update", {
    projectId: p.id,
    expectedRevision: 0,
    name: "Revision one",
  });
  await expect(
    call("project.update", {
      projectId: p.id,
      expectedRevision: 0,
      name: "Old revision",
    }),
  ).rejects.toMatchObject({
    failure: { code: "revision_conflict", currentRevision: 1 },
  });
});
test("claims are exclusive, reviews are fenced and mutations replay atomically", async () => {
  const p = await call("project.create", {
    name: "Coordination",
    prefix: "ATOM",
  });
  const q = await call("project.create", {
    name: "Other project",
    prefix: "ELSE",
  });
  const first = await call("credential.create", {
    projectId: p.id,
    kind: "agent",
  });
  const second = await call("credential.create", {
    projectId: p.id,
    kind: "agent",
  });
  const agent = apiClient(service.runtime.endpoint, first.token);
  const other = apiClient(service.runtime.endpoint, second.token);
  await expect(agent("project.get", { projectId: q.id })).rejects.toMatchObject(
    { failure: { code: "scope_denied" } },
  );
  const i = await call(
    "issue.create",
    { projectId: p.id, title: "Work", criteria: ["Result"] },
    "once",
  );
  expect(
    await call(
      "issue.create",
      { title: "Work", criteria: ["Result"], projectId: p.id },
      "once",
    ),
  ).toEqual(i);
  await expect(
    call("issue.create", { projectId: p.id, title: "Changed" }, "once"),
  ).rejects.toMatchObject({ failure: { code: "idempotency_conflict" } });
  const prerequisite = await call("issue.create", {
    projectId: p.id,
    title: "Prerequisite",
  });
  await call("dependency.add", { issueId: i.id, requiresId: prerequisite.id });
  await expect(
    call("dependency.add", { issueId: prerequisite.id, requiresId: i.id }),
  ).rejects.toBeInstanceOf(ApiError);
  const blocked = await call("issue.get", { issueId: i.id });
  await call("issue.transition", {
    issueId: i.id,
    expectedRevision: blocked.revision,
    status: "Ready",
  });
  expect(await agent("issue.claimNext", { projectId: p.id })).toBeNull();
  await call("issue.complete", {
    issueId: prerequisite.id,
    expectedRevision: 0,
  });
  const attempts = await Promise.allSettled([
    agent("issue.claimNext", { projectId: p.id }),
    other("issue.claim", { issueId: i.id }),
  ]);
  const claims = attempts.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  expect(claims).toHaveLength(1);
  const c = claims[0];
  const replacement = c.actor === first.credential.id ? second : first;
  const loser = c.actor === first.credential.id ? agent : other;
  const replacementClient = apiClient(
    service.runtime.endpoint,
    replacement.token,
  );
  const fenced = await call("claim.reassign", {
    issueId: i.id,
    generation: c.generation,
    actorId: replacement.credential.id,
    reason: "Owner recovered interrupted work",
  });
  await expect(
    loser("comment.add", {
      issueId: i.id,
      generation: c.generation,
      body: "Old owner",
    }),
  ).rejects.toMatchObject({ failure: { code: "stale_claim" } });
  const current = await replacementClient("issue.get", { issueId: i.id });
  const review = await replacementClient("review.submit", {
    issueId: i.id,
    generation: fenced.generation,
    expectedRevision: current.revision,
    evidence: {
      summary: "Implemented",
      criteria: [current.criteria[0].id],
      checks: ["local test"],
      references: [],
      limitations: "",
    },
  });
  await expect(
    replacementClient("review.decide", {
      reviewId: review.id,
      decision: "approve",
      reason: "Self",
    }),
  ).rejects.toMatchObject({ failure: { code: "permission_denied" } });
  await call("review.decide", {
    reviewId: review.id,
    decision: "changes",
    reason: "Cover the alternate path",
  });
  await expect(
    call("review.decide", {
      reviewId: review.id,
      decision: "approve",
      reason: "Old submission",
    }),
  ).rejects.toMatchObject({ failure: { code: "review_conflict" } });
  const revision = (await call("issue.get", { issueId: i.id })).revision;
  const submitted = await replacementClient("review.submit", {
    issueId: i.id,
    generation: fenced.generation,
    expectedRevision: revision,
    evidence: review.evidence,
  });
  await call("review.decide", {
    reviewId: submitted.id,
    decision: "approve",
    reason: "Criteria met",
  });
  expect(await call("issue.context", { issueId: i.id })).toMatchObject({
    claim: null,
    issue: { status: "Done", criteria: [{ accepted: true }] },
  });
  const exported = await call("project.export", { projectId: p.id });
  const imported = await call("project.import", {
    name: "Transferred",
    prefix: "COPY",
    data: exported,
  });
  expect(imported.remapped).toHaveLength(2);
  const events = (await call("event.list", { projectId: p.id, limit: 100 }))
    .items;
  expect(events.filter((e) => e.operation === "issue.create")).toHaveLength(2);
  expect(events.filter((e) => e.operation === "dependency.add")).toHaveLength(
    1,
  );
});
test("directory ownership and claim state survive a service restart", async () => {
  const p = await call("project.create", { name: "Durability", prefix: "DUR" });
  const i = await call("issue.create", {
    projectId: p.id,
    title: "Persistent claim",
  });
  await call("issue.transition", {
    issueId: i.id,
    expectedRevision: 0,
    status: "Ready",
  });
  const c = await call("issue.claim", { issueId: i.id });
  await expect(startService({ mode: "headless" })).rejects.toMatchObject({
    code: "service_owned",
  });
  await service.close();
  service = await startService({ mode: "headless" });
  call = apiClient(service.runtime.endpoint, ownerToken);
  expect((await call("issue.context", { issueId: i.id })).claim).toEqual(c);
});

test("bootstrap preserves unmanaged MCP configuration and supports scoped requests", async () => {
  const p = await call("project.create", { name: "Bootstrap", prefix: "BOOT" });
  const root = mkdtempSync(join(tmpdir(), "kordlet bootstrap ü "));
  const config = join(root, ".mcp.json");
  const unrelated = { mcpServers: { other: { command: "other" } } };
  writeFileSync(config, JSON.stringify(unrelated));
  const cli = (...args: string[]) =>
    execute(
      process.execPath,
      [
        cliPath,
        "bootstrap",
        "--tool",
        "claude",
        "--scope",
        "project",
        "--project",
        p.id,
        "--json",
        ...args,
      ],
      { cwd: root, env: cliEnv },
    );
  try {
    expect(JSON.parse((await cli("--dry-run")).stdout).files).toContain(
      ".mcp.json",
    );
    expect(JSON.parse(readFileSync(config, "utf8"))).toEqual(unrelated);
    await cli();
    const settings = JSON.parse(readFileSync(config, "utf8"));
    expect(settings.mcpServers.other).toEqual(unrelated.mcpServers.other);
    expect(settings.mcpServers.kordlet.args).toContain(p.id);
    expect(JSON.parse((await cli()).stdout).files).toEqual([]);
    const connected = new Client({ name: "bootstrap-test", version: "1" });
    try {
      await connected.connect(
        new StdioClientTransport({
          ...settings.mcpServers.kordlet,
          env: cliEnv as Record<string, string>,
        }),
      );
      const result = await connected.callTool({
        name: "project_get",
        arguments: { projectId: p.id },
      });
      expect(result.structuredContent).toMatchObject({ result: { id: p.id } });
      const denied = await connected.callTool({
        name: "project_create",
        arguments: { name: "Disallowed", prefix: "NEW" },
      });
      expect(denied.structuredContent).toMatchObject({
        error: { code: "permission_denied" },
      });
    } finally {
      await connected.close();
    }
    await cli("--remove");
    expect(JSON.parse(readFileSync(config, "utf8"))).toEqual(unrelated);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("backup and restore preserve persistent records and reject newer schema", async () => {
  const p = await call("project.create", {
    name: "Backup fixture",
    prefix: "BAK",
  });
  const protectedClaim = (await call("issue.list", { projectId: p.id })).items
    .length;
  expect(protectedClaim).toBe(0);
  const backup = join(dir, "round trip ü.sqlite");
  await service.close();
  await execute(process.execPath, [cliPath, "backup", backup, "--json"], {
    env: cliEnv,
  });
  service = await startService({ mode: "headless" });
  call = apiClient(service.runtime.endpoint, ownerToken);
  const changed = await call("project.update", {
    projectId: p.id,
    expectedRevision: 0,
    name: "Discard on restore",
  });
  expect(changed.name).toBe("Discard on restore");
  await service.close();
  const unsupported = join(dir, "newer.sqlite");
  const future = new SQLite(unsupported);
  future.pragma("user_version=999");
  future.close();
  await expect(
    execute(process.execPath, [cliPath, "restore", unsupported, "--json"], {
      env: cliEnv,
    }),
  ).rejects.toMatchObject({ stdout: expect.stringContaining("unsupported") });
  await execute(process.execPath, [cliPath, "restore", backup, "--json"], {
    env: cliEnv,
  });
  service = await startService({ mode: "headless" });
  call = apiClient(service.runtime.endpoint, ownerToken);
  expect(await call("project.get", { projectId: p.id })).toEqual(p);
});
