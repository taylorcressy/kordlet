import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { apiClient } from "../../packages/client/index.ts";

let service: ChildProcess;
let dir: string;
let url: string;
test.beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kordlet browser ü "));
  service = spawn(process.execPath, ["dist/server.mjs"], {
    env: { ...process.env, KORDLET_DATA_DIR: dir },
    stdio: ["ignore", "pipe", "inherit"],
  });
  url = await new Promise<string>((resolve, reject) => {
    service.stdout!.once("data", (data) => resolve(String(data).trim()));
    service.once("exit", (code) =>
      reject(Error("Service exited with " + code)),
    );
  });
});
test.afterEach(async () => {
  if (service.exitCode === null) {
    const exited = once(service, "exit");
    service.kill();
    await exited;
  }
  rmSync(dir, { force: true, recursive: true });
});
test("empty workspace, keyboard creation, persisted claim and human review", async ({
  page,
}) => {
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Create your first project" }),
  ).toBeVisible();
  await page.keyboard.press("n");
  await page.getByLabel("Name", { exact: true }).fill("Browser project");
  await page.getByLabel("Issue key prefix").fill("WEB");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("region", { name: "Backlog" })).toBeVisible();
  await page.keyboard.press("n");
  await page
    .getByLabel("Title", { exact: true })
    .fill("Verify keyboard workflow");
  await page
    .getByLabel("Acceptance criteria")
    .fill("Create and review an issue");
  await page.getByRole("button", { name: "Create issue" }).click();
  await expect(
    page.getByRole("heading", { name: "Verify keyboard workflow" }),
  ).toBeVisible();
  await page.getByLabel("Move issue").selectOption("Ready");
  const endpoint = new URL(url).origin;
  const owner = apiClient(
    endpoint,
    readFileSync(join(dir, "owner.token"), "utf8"),
  );
  const project = (await owner("project.list", {})).items[0];
  const issue = (await owner("issue.list", { projectId: project.id })).items[0];
  await expect
    .poll(async () => (await owner("issue.get", { issueId: issue.id })).status)
    .toBe("Ready");
  const { token } = await owner("credential.create", {
    projectId: project.id,
    kind: "agent",
  });
  const agent = apiClient(endpoint, token);
  const claim = await agent("issue.claim", { issueId: issue.id });
  const current = await agent("issue.get", { issueId: issue.id });
  await agent("review.submit", {
    issueId: issue.id,
    generation: claim.generation,
    expectedRevision: current.revision,
    evidence: {
      summary: "Executed browser flow",
      criteria: [current.criteria[0].id],
      checks: ["Browser test · reported passing"],
      references: [],
      limitations: "",
    },
  });
  await expect(page.getByText("Executed browser flow")).toBeVisible();
  await page.getByLabel("Decision reason").fill("Confirmed in browser");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Done" })
      .getByRole("button", { name: /Verify keyboard workflow/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Done" })
      .getByRole("button", { name: /Verify keyboard workflow/ }),
  ).toBeVisible();
});
test("opt-in sample board and narrow issue inspector", async ({ page }) => {
  await page.goto(url);
  await page.getByRole("button", { name: "Load demo project" }).click();
  await expect(
    page.getByRole("heading", { name: "Implement MCP server for agent tools" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Done" })
      .getByRole("button", { name: /Project scaffolding/ }),
  ).toBeVisible();
  if (process.env.KORDLET_SCREENSHOT)
    await page.screenshot({ path: process.env.KORDLET_SCREENSHOT });
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(
    page.getByRole("complementary", { name: "Issue details" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("complementary", { name: "Issue details" }),
  ).toHaveCount(0);
});

test("stream reconnect refreshes the board after an offline change", async ({
  page,
  context,
}) => {
  await page.goto(url);
  await page.getByRole("button", { name: "Load demo project" }).click();
  await expect(
    page.getByRole("heading", { name: "Implement MCP server for agent tools" }),
  ).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "Reconnect" })).toBeVisible({
    timeout: 10000,
  });
  const owner = apiClient(
    new URL(url).origin,
    readFileSync(join(dir, "owner.token"), "utf8"),
  );
  const project = (await owner("project.list", {})).items[0];
  await owner("issue.create", {
    projectId: project.id,
    title: "Created while browser was offline",
  });
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: /Created while browser was offline/ }),
  ).toBeVisible({ timeout: 15000 });
});

test("Workspace agent project and issue changes refresh the workspace without a reload", async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole("heading", { name: "Create your first project" })).toBeVisible();
  const agent = apiClient(
    new URL(url).origin,
    readFileSync(join(dir, "profile-workspace-agent.token"), "utf8"),
  );
  const first = await agent("project.create", { name: "Agent project", prefix: "AGENT" });
  await agent("issue.create", { projectId: first.id, title: "Agent's first issue" });
  await expect(page.getByRole("button", { name: /Agent's first issue/ })).toBeVisible();

  const second = await agent("project.create", { name: "Another agent project", prefix: "OTHER" });
  await expect(page.getByLabel("Project", { exact: true })).toHaveValue(first.id);
  await expect(page.getByRole("option", { name: "Another agent project" })).toHaveCount(1);
  await agent("issue.create", { projectId: first.id, title: "Agent follow-up issue" });
  await expect(page.getByRole("button", { name: /Agent follow-up issue/ })).toBeVisible();
  await page.getByLabel("Project", { exact: true }).selectOption(second.id);
  await expect(page.getByRole("button", { name: /Agent follow-up issue/ })).toHaveCount(0);
});

test("project deletion requires an owner UI session and removes related data", async ({ page, request }) => {
  const endpoint = new URL(url).origin;
  const ownerToken = readFileSync(join(dir, "owner.token"), "utf8");
  const owner = apiClient(endpoint, ownerToken);
  const keep = await owner("project.create", { name: "Keep this project", prefix: "KEEP" });
  const target = await owner("project.create", { name: "Delete this project", prefix: "DEL" });
  const first = await owner("issue.create", { projectId: target.id, title: "First issue" });
  const second = await owner("issue.create", { projectId: target.id, title: "Second issue" });
  await owner("dependency.add", { issueId: second.id, requiresId: first.id });
  const { token } = await owner("credential.create", { projectId: target.id, kind: "agent" });
  const deletion = "/session/projects/" + target.id + "/delete";
  const bearer = await request.post(endpoint + deletion, {
    headers: { Authorization: "Bearer " + ownerToken, Origin: endpoint },
    data: { expectedRevision: target.revision, confirmation: target.name },
  });
  expect(bearer.status()).toBe(403);

  await page.goto(url);
  await page.getByLabel("Project", { exact: true }).selectOption(target.id);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Edit Delete this project" }).click();
  await page.getByRole("button", { name: "Delete project…" }).click();
  await page.getByLabel("Type the project name").fill("Wrong name");
  await page.getByRole("button", { name: "Permanently delete" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("exact project name");
  await page.getByLabel("Type the project name").fill(target.name);
  await page.getByRole("button", { name: "Permanently delete" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("option", { name: target.name })).toHaveCount(0);
  await expect(page.getByLabel("Project", { exact: true })).toHaveValue(keep.id);
  await expect(owner("issue.get", { issueId: first.id })).rejects.toThrow("Issue not found");
  await expect(apiClient(endpoint, token)("project.get", { projectId: target.id })).rejects.toThrow();
  expect((await owner("project.get", { projectId: keep.id })).id).toBe(keep.id);
});
