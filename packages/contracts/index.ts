import {
  Type as T,
  type TSchema,
  type Static,
  type TOptional,
} from "@sinclair/typebox";
export const product = {
  name: "Kordlet",
  cli: "kordlet",
  version: "0.1.0",
  api: "1",
  contract: "1",
};
const object = T.Object;
const opt = T.Optional;
const str = (max = 240) => T.String({ maxLength: max });
const id = T.String({ minLength: 1, maxLength: 100 });
const num = T.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const nullable = <S extends TSchema>(schema: S) => T.Union([schema, T.Null()]);
const array = <S extends TSchema>(schema: S, maxItems = 50) =>
  T.Array(schema, { maxItems });
const choices = <const S extends readonly string[]>(...values: S) =>
  T.Unsafe<S[number]>({ type: "string", enum: values });
export const statuses = [
  "Backlog",
  "Ready",
  "In progress",
  "In review",
  "Done",
  "Canceled",
] as const;
const status = choices(...statuses);
const priority = choices("Low", "Medium", "High", "Urgent");
const type = choices("task", "bug", "epic");
const text = str(32000);
const fields = {
  title: T.String({ minLength: 1, maxLength: 240 }),
  description: text,
  type,
  priority,
  labels: array(str(40), 20),
  assignee: nullable(str(100)),
  parentId: nullable(id),
  blocker: nullable(str(1000)),
};
const optional = <S extends Record<string, TSchema>>(fields: S) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, opt(v)])) as {
    [K in keyof S]: TOptional<S[K]>;
  };
const strict = { additionalProperties: false };
const criterion = object(
  { id, text: str(1000), reported: T.Boolean(), accepted: T.Boolean() },
  strict,
);
const project = object(
  {
    id,
    name: str(),
    prefix: str(10),
    repository: nullable(str(4096)),
    revision: num,
    archived: T.Boolean(),
  },
  strict,
);
const issue = object(
  {
    ...fields,
    id,
    key: id,
    projectId: id,
    status,
    revision: num,
    archived: T.Boolean(),
    createdAt: str(),
    updatedAt: str(),
    criteria: array(criterion),
    blocked: T.Boolean(),
  },
  strict,
);
const claim = object(
  {
    id,
    issueId: id,
    actor: id,
    generation: num,
    createdAt: str(),
    lastSeenAt: str(),
  },
  strict,
);
const comment = object(
  { id, issueId: id, actor: id, body: text, createdAt: str() },
  strict,
);
const evidence = object(
  {
    summary: text,
    criteria: array(id),
    checks: array(str(4000)),
    references: array(str(1000)),
    limitations: text,
  },
  strict,
);
const review = object(
  {
    id,
    actor: id,
    issueId: id,
    revision: num,
    createdAt: str(),
    criteria: array(criterion),
    evidence,
    decision: nullable(choices("approve", "changes")),
    reason: nullable(text),
    reviewer: nullable(id),
  },
  strict,
);
const event = object(
  {
    sequence: num,
    actor: id,
    operation: str(),
    entity: id,
    projectId: nullable(id),
    createdAt: str(),
    reason: opt(str(4000)),
    fields: opt(array(str(), 40)),
  },
  strict,
);
const dependency = object({ issueId: id, requiresId: id }, strict);
const page = <S extends TSchema>(item: S) =>
  object({ items: array(item, 100), cursor: nullable(num) }, strict);
const credential = object(
  {
    id,
    projectId: id,
    kind: choices("agent", "reviewer"),
    revoked: T.Boolean(),
  },
  strict,
);
const portable = object(
  {
    version: T.Literal(1),
    name: str(),
    issues: array(issue, 1000),
    dependencies: array(dependency, 10000),
    comments: array(comment, 10000),
    reviews: array(review, 10000),
  },
  strict,
);
export const errorSchema = object(
  {
    code: str(),
    message: str(4000),
    requestId: str(),
    retryable: T.Boolean(),
    currentRevision: opt(num),
  },
  strict,
);
const pagination = {
  cursor: opt(num),
  limit: opt(T.Integer({ minimum: 1, maximum: 100 })),
};
function op<I extends Record<string, TSchema>, O extends TSchema>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  input: I,
  output: O,
  role: "any" | "owner" | "agent" | "reviewer" | "project-creator" | "review-decider" = "any",
) {
  return {
    method,
    path,
    input: object(input, strict),
    output,
    role,
    error: errorSchema,
  };
}
const issuePath = "/issues/:issueId";
const projectPath = "/projects/:projectId";
const issueId = { issueId: id };
const projectId = { projectId: id };
const revision = { expectedRevision: num };
const fence = { generation: num };
export const workspaceAgentProfile = "workspace-agent";
export const projectDiscoveryInstructions =
  "List existing projects using project_list and match the repository path to the current checkout, or read its .kordlet-project.json if present. Use project_get to verify a selected project. If no project matches and the user wants to start tracking this repository, use project_create with its path, name, and a unique issue key prefix. If the match is ambiguous, ask which project to use. Use the returned project ID for subsequent calls.";

export const reviewInstructions =
  "When asked to review, fetch issue_context and keep the implementer's claim in place. Post findings with comment_add using kind review_feedback, even before a submission exists. Progress comments still require the active claim and generation. If a pending submission from another session exists, use review_decide with changes when asked to request changes. Leave approval to the owner or an explicitly authorized reviewer. If no submission exists, leave findings as a comment and ask the implementer to submit.";


export const operations = {
  "project.create": op(
    "POST",
    "/projects",
    {
      name: fields.title,
      prefix: T.String({ pattern: "^[A-Z][A-Z0-9]{1,9}$" }),
      repository: opt(str(4096)),
    },
    project,
    "project-creator",
  ),
  "project.list": op("GET", "/projects", pagination, page(project)),
  "project.get": op("GET", projectPath, projectId, project),
  "project.update": op(
    "PATCH",
    projectPath,
    {
      ...projectId,
      ...revision,
      name: opt(fields.title),
      repository: opt(nullable(str(4096))),
      archived: opt(T.Boolean()),
    },
    project,
    "owner",
  ),
  "issue.create": op(
    "POST",
    projectPath + "/issues",
    {
      ...projectId,
      ...optional(fields),
      title: fields.title,
      criteria: opt(array(str(1000))),
    },
    issue,
  ),
  "issue.list": op(
    "GET",
    "/issues",
    {
      ...pagination,
      projectId: opt(id),
      status: opt(status),
      search: opt(str()),
      blocked: opt(T.Boolean()),
      mine: opt(T.Boolean()),
      ready: opt(T.Boolean()),
      archived: opt(T.Boolean()),
    },
    page(issue),
  ),
  "issue.get": op("GET", issuePath, issueId, issue),
  "issue.update": op(
    "PATCH",
    issuePath,
    {
      ...issueId,
      ...revision,
      ...optional(fields),
      criteria: opt(array(str(1000))),
      generation: opt(num),
    },
    issue,
  ),
  "issue.transition": op(
    "POST",
    issuePath + "/transitions",
    {
      ...issueId,
      ...revision,
      status: choices("Backlog", "Ready", "Canceled"),
      reason: opt(str()),
    },
    issue,
    "owner",
  ),
  "issue.complete": op(
    "POST",
    issuePath + "/completion",
    { ...issueId, ...revision },
    issue,
    "reviewer",
  ),
  "issue.archive": op(
    "POST",
    issuePath + "/archive",
    { ...issueId, ...revision, archived: T.Boolean() },
    issue,
    "owner",
  ),
  "dependency.add": op(
    "POST",
    issuePath + "/dependencies",
    { ...issueId, requiresId: id },
    dependency,
    "owner",
  ),
  "dependency.remove": op(
    "DELETE",
    issuePath + "/dependencies/:requiresId",
    { ...issueId, requiresId: id },
    dependency,
    "owner",
  ),
  "issue.claim": op("POST", issuePath + "/claims", issueId, claim),
  "issue.claimNext": op(
    "POST",
    projectPath + "/claims/next",
    projectId,
    nullable(claim),
  ),
  "claim.heartbeat": op(
    "POST",
    issuePath + "/claim/activity",
    { ...issueId, ...fence },
    claim,
  ),
  "claim.release": op(
    "POST",
    issuePath + "/claim/release",
    { ...issueId, ...fence, reason: fields.title },
    issue,
  ),
  "claim.reassign": op(
    "POST",
    issuePath + "/claim/reassignment",
    { ...issueId, ...fence, actorId: id, reason: fields.title },
    claim,
    "owner",
  ),
  "comment.add": op(
    "POST",
    issuePath + "/comments",
    {
      ...issueId,
      body: T.String({ minLength: 1, maxLength: 32000 }),
      generation: opt(num),
      kind: opt(choices("review_feedback")),
    },
    comment,
  ),
  "comment.list": op(
    "GET",
    issuePath + "/comments",
    { ...issueId, ...pagination },
    page(comment),
  ),
  "review.submit": op(
    "POST",
    issuePath + "/reviews",
    { ...issueId, ...fence, ...revision, evidence },
    review,
  ),
  "review.decide": op(
    "POST",
    "/reviews/:reviewId/decisions",
    {
      reviewId: id,
      decision: choices("approve", "changes"),
      reason: fields.title,
    },
    review,
    "review-decider",
  ),
  "review.list": op(
    "GET",
    "/reviews",
    { ...pagination, projectId: opt(id), pending: opt(T.Boolean()) },
    page(review),
  ),
  "issue.context": op(
    "GET",
    issuePath + "/context",
    issueId,
    object(
      {
        issue,
        claim: nullable(claim),
        latestReview: nullable(review),
        dependencies: array(issue, 100),
      },
      strict,
    ),
  ),
  "event.list": op(
    "GET",
    "/events",
    { ...pagination, projectId: opt(id), entity: opt(id) },
    page(event),
  ),
  "credential.create": op(
    "POST",
    projectPath + "/credentials",
    { ...projectId, kind: choices("agent", "reviewer") },
    object({ credential, token: str() }, strict),
    "owner",
  ),
  "credential.list": op(
    "GET",
    projectPath + "/credentials",
    { ...projectId, ...pagination },
    page(credential),
    "owner",
  ),
  "credential.revoke": op(
    "DELETE",
    projectPath + "/credentials/:credentialId",
    { ...projectId, credentialId: id },
    credential,
    "owner",
  ),
  "project.export": op(
    "GET",
    projectPath + "/export",
    projectId,
    portable,
    "owner",
  ),
  "project.import": op(
    "POST",
    "/imports",
    {
      name: fields.title,
      prefix: T.String({ pattern: "^[A-Z][A-Z0-9]{1,9}$" }),
      data: portable,
    },
    object(
      {
        project,
        remapped: array(object({ from: id, to: id, key: id }, strict), 1000),
      },
      strict,
    ),
    "owner",
  ),
  "workspace.instructions": op(
    "GET",
    "/instructions",
    {},
    object({ workflow: text }, strict),
  ),
} as const;
export type Operation = keyof typeof operations;
export type Input<K extends Operation> = Static<
  (typeof operations)[K]["input"]
>;
export type Output<K extends Operation> = Static<
  (typeof operations)[K]["output"]
>;
export type Project = Static<typeof project>;
export type Issue = Static<typeof issue>;
export type Actor = {
  id: string;
  kind: "owner" | "agent" | "reviewer";
  projectId?: string;
  peerReview?: true;
};
export const entries = Object.entries(operations) as [
  Operation,
  (typeof operations)[Operation],
][];
export const toolName = (operation: Operation) =>
  operation.replace(/\./g, "_").replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
export const commandName = (operation: Operation) =>
  toolName(operation).replace("_", " ").replaceAll("_", "-");
