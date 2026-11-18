import SQLite from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import {
  operations,
  type Actor,
  type Input,
  type Issue,
  type Operation,
  type Output,
  type Project,
} from "../contracts";
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 409,
    public currentRevision?: number,
  ) {
    super(message);
  }
}
function requireThat(
  test: unknown,
  code: string,
  message: string,
  status = 409,
): asserts test {
  if (!test) throw new DomainError(code, message, status);
}
type Claim = Output<"issue.claim">;
type Review = Output<"review.submit">;
type Comment = Output<"comment.add">;
type Credential = Output<"credential.list">["items"][number];
const scoped = (actor: Actor, projectId: string) =>
  requireThat(
    !actor.projectId || actor.projectId === projectId,
    "scope_denied",
    "Credential does not cover this project.",
    403,
  );
function revision(input: number, current: number) {
  if (input !== current)
    throw new DomainError(
      "revision_conflict",
      "Refresh the record and try again.",
      409,
      current,
    );
}
const transition = {
  claim: { from: ["Ready"], to: "In progress" },
  submit: { from: ["In progress"], to: "In review" },
  changes: { from: ["In review"], to: "In progress" },
  approve: { from: ["In review"], to: "Done" },
  complete: { from: ["Backlog", "Ready", "In progress"], to: "Done" },
  release: { from: ["In progress", "In review"], to: "Ready" },
  backlog: { from: ["Backlog", "Ready", "Canceled"], to: "Backlog" },
  ready: { from: ["Backlog", "Ready", "Done", "Canceled"], to: "Ready" },
  cancel: {
    from: ["Backlog", "Ready", "In progress", "In review"],
    to: "Canceled",
  },
} as const;
function move(issue: Issue, action: keyof typeof transition) {
  const { from, to } = transition[action];
  requireThat(
    !issue.archived && (from as readonly string[]).includes(issue.status),
    "invalid_transition",
    "The current issue status does not allow this action.",
  );
  issue.status = to;
}
export function openStore(filename: string) {
  const db = new SQLite(filename);
  try {
    const version = db.pragma("user_version", { simple: true });
    requireThat(
      version === 0 || version === 1,
      "schema_incompatible",
      "This database was created by an unsupported Kordlet version.",
    );
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 3000");
    db.pragma("journal_mode = WAL");
    if (version === 0)
      db.transaction(() =>
        db.exec(`
 CREATE TABLE projects(id TEXT PRIMARY KEY,prefix TEXT UNIQUE NOT NULL,counter INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL);
 CREATE TABLE issues(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),data TEXT NOT NULL,
 status TEXT GENERATED ALWAYS AS (json_extract(data,'$.status')) STORED,
 priority INTEGER GENERATED ALWAYS AS (CASE json_extract(data,'$.priority') WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END) STORED,
 archived INTEGER GENERATED ALWAYS AS (json_extract(data,'$.archived')) STORED);
 CREATE INDEX issue_queue ON issues(project_id,archived,status,priority);
 CREATE UNIQUE INDEX issue_key ON issues(json_extract(data,'$.key'));
 CREATE TABLE dependencies(issue_id TEXT REFERENCES issues(id), requires_id TEXT REFERENCES issues(id),PRIMARY KEY(issue_id,requires_id));
 CREATE INDEX prerequisite ON dependencies(requires_id);
 CREATE TABLE claims(issue_id TEXT PRIMARY KEY REFERENCES issues(id),generation INTEGER NOT NULL,data TEXT);
 CREATE TABLE comments(id TEXT PRIMARY KEY,issue_id TEXT REFERENCES issues(id),data TEXT NOT NULL);
 CREATE INDEX issue_comments ON comments(issue_id);
 CREATE TABLE reviews(id TEXT PRIMARY KEY,issue_id TEXT REFERENCES issues(id),data TEXT NOT NULL);
 CREATE INDEX issue_reviews ON reviews(issue_id);
 CREATE TABLE credentials(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),hash TEXT UNIQUE,data TEXT NOT NULL);
 CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT,data TEXT NOT NULL);
 CREATE INDEX project_events ON events(project_id,sequence);
 CREATE TABLE requests(actor TEXT,scope TEXT,operation TEXT,key TEXT,hash TEXT,result TEXT,PRIMARY KEY(actor,scope,operation,key));
 PRAGMA user_version=1;
 `),
      ).immediate();
  } catch (error) {
    db.close();
    throw error;
  }
  const get = <T>(sql: string, ...params: unknown[]) =>
    db.prepare(sql).get(...params) as T | undefined;
  const all = <T>(sql: string, ...params: unknown[]) =>
    db.prepare(sql).all(...params) as T[];
  const run = (sql: string, ...params: unknown[]) =>
    db.prepare(sql).run(...params);
  const read = <T>(sql: string, ...params: unknown[]): T | undefined => {
    const row = get<{ data: string }>(sql, ...params);
    return row && (JSON.parse(row.data) as T);
  };
  const records = <T>(sql: string, ...params: unknown[]) =>
    all<{ data: string }>(sql, ...params).map(
      (row) => JSON.parse(row.data) as T,
    );
  const encode = JSON.stringify;
  function project(id: string, actor: Actor) {
    scoped(actor, id);
    const value = read<Project>("SELECT data FROM projects WHERE id=?", id);
    requireThat(value, "not_found", "Project not found.", 404);
    return value;
  }
  function issue(id: string, actor: Actor) {
    const value = read<Issue>("SELECT data FROM issues WHERE id=?", id);
    requireThat(value, "not_found", "Issue not found.", 404);
    scoped(actor, value.projectId);
    value.blocked = isBlocked(value);
    return value;
  }
  const blockedSql = `(coalesce(length(json_extract(i.data,'$.blocker')),0)>0 OR EXISTS(SELECT 1 FROM dependencies d JOIN issues p ON p.id=d.requires_id WHERE d.issue_id=i.id AND (p.status!='Done' OR p.archived)))`;
  const isBlocked = (value: Issue) =>
    Boolean(
      value.blocker ||
      get(
        "SELECT 1 FROM dependencies d JOIN issues p ON p.id=d.requires_id WHERE d.issue_id=? AND (p.status!=? OR p.archived) LIMIT 1",
        value.id,
        "Done",
      ),
    );
  const active = (id: string) =>
    read<Claim | null>(
      "SELECT coalesce(data,'null') AS data FROM claims WHERE issue_id=?",
      id,
    ) ?? null;
  const latest = (id: string) =>
    read<Review>(
      "SELECT data FROM reviews WHERE issue_id=? ORDER BY rowid DESC LIMIT 1",
      id,
    ) ?? null;
  const save = (value: Issue) =>
    run("UPDATE issues SET data=? WHERE id=?", encode(value), value.id);
  const audit = (
    actor: Actor,
    operation: string,
    entity: string,
    projectId: string | null,
    metadata: { fields?: string[]; reason?: string },
  ) =>
    run(
      "INSERT INTO events(project_id,data) VALUES (?,?)",
      projectId,
      encode({
        actor: actor.id,
        operation,
        entity,
        projectId,
        createdAt: now(),
        ...metadata,
      }),
    );
  const bump = (value: Issue) => {
    value.revision++;
    value.updatedAt = now();
    value.blocked = isBlocked(value);
    save(value);
    return value;
  };
  function page<T>(
    sql: string,
    params: unknown[],
    input: { cursor?: number; limit?: number },
    map: (row: { data: string; cursor: number }) => T,
  ) {
    const limit = input.limit ?? 50;
    const rows = all<{ data: string; cursor: number }>(
      sql,
      ...params,
      input.cursor ?? 0,
      limit + 1,
    );
    return {
      items: rows.slice(0, limit).map(map),
      cursor: rows.length > limit ? rows[limit - 1].cursor : null,
    };
  }
  function makeProject(
    name: string,
    prefix: string,
    repository: string | null,
  ): Project {
    requireThat(name.trim(), "invalid_input", "Project name is required.", 400);
    requireThat(
      !get("SELECT 1 FROM projects WHERE prefix=?", prefix),
      "duplicate_key",
      "Project prefix already exists.",
    );
    const p = {
      id: randomUUID(),
      name: name.trim(),
      prefix,
      repository,
      revision: 0,
      archived: false,
    };
    run(
      "INSERT INTO projects(id,prefix,data) VALUES (?,?,?)",
      p.id,
      p.prefix,
      encode(p),
    );
    return p;
  }
  function parent(value: Issue, id: string | null) {
    if (!id) return;
    let current: string | null = id;
    while (current) {
      requireThat(
        current !== value.id,
        "relationship_cycle",
        "Parent would create a cycle.",
      );
      const record = issue(current, { id: "internal", kind: "owner" });
      requireThat(
        record.projectId === value.projectId,
        "cross_project",
        "Parent must belong to the same project.",
      );
      current = record.parentId;
    }
  }
  function link(i: Issue, requires: Issue) {
    requireThat(
      i.projectId === requires.projectId,
      "cross_project",
      "Prerequisite must belong to the same project.",
    );
    requireThat(
      i.id !== requires.id &&
        !get(
          `WITH RECURSIVE chain(id) AS (SELECT ? UNION SELECT d.requires_id FROM dependencies d JOIN chain ON d.issue_id=chain.id) SELECT 1 FROM chain WHERE id=?`,
          requires.id,
          i.id,
        ),
      "relationship_cycle",
      "Dependency would create a cycle.",
    );
    requireThat(
      !get(
        "SELECT 1 FROM dependencies WHERE issue_id=? AND requires_id=?",
        i.id,
        requires.id,
      ),
      "duplicate_dependency",
      "Dependency already exists.",
    );
    requireThat(
      !["In review", "Done"].includes(i.status),
      "invalid_transition",
      "Reopen the issue before changing prerequisites.",
    );
    requireThat(
      !get(
        "SELECT 1 FROM dependencies WHERE issue_id=? LIMIT 1 OFFSET 99",
        i.id,
      ),
      "limit_exceeded",
      "An issue can have at most 100 prerequisites.",
    );
    run("INSERT INTO dependencies VALUES (?,?)", i.id, requires.id);
  }
  function fence(
    id: string,
    actor: Actor,
    generation: number | undefined,
    ownerOverride = false,
  ) {
    const c = active(id);
    requireThat(
      c &&
        c.generation === generation &&
        (c.actor === actor.id || (ownerOverride && actor.kind === "owner")),
      "stale_claim",
      "An active claim with the current actor and generation is required.",
    );
    return c;
  }
  function reserve(i: Issue, actorId: string) {
    const previous = get<{ generation: number }>(
      "SELECT generation FROM claims WHERE issue_id=?",
      i.id,
    );
    const date = now();
    const c = {
      id: randomUUID(),
      actor: actorId,
      issueId: i.id,
      generation: (previous?.generation ?? 0) + 1,
      createdAt: date,
      lastSeenAt: date,
    };
    run(
      "INSERT INTO claims(issue_id,generation,data) VALUES (?,?,?) ON CONFLICT(issue_id) DO UPDATE SET generation=excluded.generation,data=excluded.data",
      i.id,
      c.generation,
      encode(c),
    );
    return c;
  }
  function claim(i: Issue, actor: Actor) {
    requireThat(
      !project(i.projectId, actor).archived &&
        i.type !== "epic" &&
        !i.blocked &&
        !active(i.id),
      "not_claimable",
      "Issue is blocked, archived, an epic, or already claimed.",
    );
    move(i, "claim");
    bump(i);
    return reserve(i, actor.id);
  }
  function editable(i: Issue, actor: Actor, generation?: number) {
    requireThat(
      !i.archived && !["Done", "Canceled"].includes(i.status),
      "invalid_transition",
      "Reopen this issue before editing.",
    );
    if (actor.kind === "agent" || (active(i.id) && actor.kind !== "owner"))
      fence(i.id, actor, generation);
  }
  const handlers: {
    [K in Operation]: (input: Input<K>, actor: Actor) => Output<K>;
  } = {
    "project.create": (x) =>
      makeProject(x.name, x.prefix, x.repository ?? null),
    "project.get": (x, a) => project(x.projectId, a),
    "project.list": (x, a) =>
      page(
        "SELECT rowid cursor,data FROM projects WHERE (? IS NULL OR id=?) AND rowid>? ORDER BY rowid LIMIT ?",
        [a.projectId ?? null, a.projectId ?? null],
        x,
        (r) => JSON.parse(r.data),
      ),
    "project.update": ({ projectId, expectedRevision, ...fields }, a) => {
      const p = project(projectId, a);
      revision(expectedRevision, p.revision);
      requireThat(
        fields.name === undefined || fields.name.trim(),
        "invalid_input",
        "Project name is required.",
        400,
      );
      Object.assign(p, fields, { revision: p.revision + 1 });
      run("UPDATE projects SET data=? WHERE id=?", encode(p), p.id);
      return p;
    },
    "issue.create": ({ projectId, criteria, ...fields }, a) => {
      const p = project(projectId, a);
      requireThat(!p.archived, "archived", "Project is archived.");
      requireThat(
        fields.title.trim(),
        "invalid_input",
        "Issue title is required.",
        400,
      );
      const n = get<{ counter: number }>(
        "UPDATE projects SET counter=counter+1 WHERE id=? RETURNING counter",
        projectId,
      )!.counter;
      const date = now();
      const i: Issue = {
        description: "",
        type: "task",
        priority: "Medium",
        labels: [],
        assignee: null,
        parentId: null,
        blocker: null,
        ...fields,
        id: randomUUID(),
        key: p.prefix + "-" + n,
        projectId,
        status: "Backlog",
        revision: 0,
        archived: false,
        createdAt: date,
        updatedAt: date,
        criteria: (criteria ?? []).map((text) => ({
          id: randomUUID(),
          text,
          reported: false,
          accepted: false,
        })),
        blocked: Boolean(fields.blocker),
      };
      parent(i, i.parentId);
      run(
        "INSERT INTO issues(id,project_id,data) VALUES (?,?,?)",
        i.id,
        projectId,
        encode(i),
      );
      return i;
    },
    "issue.get": (x, a) => issue(x.issueId, a),
    "issue.list": (x, a) => {
      if (x.projectId) scoped(a, x.projectId);
      const scope = x.projectId ?? a.projectId ?? null;
      const search = x.search?.toLowerCase() ?? "";
      const predicate = x.ready
        ? ` AND i.status='Ready' AND json_extract(i.data,'$.type')!='epic' AND NOT ${blockedSql} AND NOT EXISTS(SELECT 1 FROM claims c WHERE c.issue_id=i.id AND c.data IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND json_extract(p.data,'$.archived'))`
        : "";
      return page(
        `SELECT i.rowid cursor,json_set(i.data,'$.blocked',json(CASE WHEN ${blockedSql} THEN 'true' ELSE 'false' END)) AS data FROM issues i WHERE
   (? IS NULL OR i.project_id=?) AND i.archived=? AND (? IS NULL OR i.status=?)
   AND (? IS NULL OR ${blockedSql}=?) AND (?=0 OR json_extract(i.data,'$.assignee')=? OR EXISTS(SELECT 1 FROM claims c WHERE c.issue_id=i.id AND json_extract(c.data,'$.actor')=?))
   AND instr(lower(json_extract(i.data,'$.title')||' '||json_extract(i.data,'$.key')||' '||json_extract(i.data,'$.description')),?)>0
   ${predicate} AND i.rowid>? ORDER BY i.rowid LIMIT ?`,
        [
          scope,
          scope,
          Number(x.archived ?? false),
          x.status ?? null,
          x.status ?? null,
          x.blocked === undefined ? null : Number(x.blocked),
          Number(x.blocked ?? false),
          Number(x.mine ?? false),
          a.id,
          a.id,
          search,
        ],
        x,
        (r) => JSON.parse(r.data),
      );
    },
    "issue.update": (
      { issueId, expectedRevision, generation, criteria, ...patch },
      a,
    ) => {
      const i = issue(issueId, a);
      revision(expectedRevision, i.revision);
      editable(i, a, generation);
      if (patch.parentId !== undefined) parent(i, patch.parentId);
      requireThat(
        patch.title === undefined || patch.title.trim(),
        "invalid_input",
        "Issue title is required.",
        400,
      );
      requireThat(
        patch.type !== "epic" || !active(i.id),
        "invalid_transition",
        "Release the claim before converting this issue to an epic.",
      );
      const previous = [...i.criteria];
      if (i.status === "In review") {
        if (active(i.id)) move(i, "changes");
        else move(i, "release");
        i.criteria = i.criteria.map((c) => ({
          ...c,
          reported: false,
          accepted: false,
        }));
      }
      Object.assign(i, patch);
      if (criteria)
        i.criteria = criteria.map((text) => {
          const at = previous.findIndex((c) => c.text === text);
          return {
            id: at === -1 ? randomUUID() : previous.splice(at, 1)[0].id,
            text,
            reported: false,
            accepted: false,
          };
        });
      return bump(i);
    },
    "issue.transition": (x, a) => {
      const i = issue(x.issueId, a);
      revision(x.expectedRevision, i.revision);
      const action =
        x.status === "Backlog"
          ? "backlog"
          : x.status === "Ready"
            ? "ready"
            : "cancel";
      requireThat(
        action === "cancel" || !active(i.id),
        "invalid_transition",
        "Release the claim before moving this issue.",
      );
      move(i, action);
      if (action === "cancel")
        run("UPDATE claims SET data=NULL WHERE issue_id=?", i.id);
      i.criteria = i.criteria.map((c) => ({
        ...c,
        reported: false,
        accepted: false,
      }));
      return bump(i);
    },
    "issue.complete": (x, a) => {
      const i = issue(x.issueId, a);
      revision(x.expectedRevision, i.revision);
      requireThat(
        !active(i.id) && !i.blocked,
        "invalid_transition",
        "Resolve blockers and submit claimed work for review.",
      );
      move(i, "complete");
      i.criteria = i.criteria.map((c) => ({ ...c, accepted: true }));
      return bump(i);
    },
    "issue.archive": (x, a) => {
      const i = issue(x.issueId, a);
      revision(x.expectedRevision, i.revision);
      if (x.archived && active(i.id)) {
        move(i, "release");
        run("UPDATE claims SET data=NULL WHERE issue_id=?", i.id);
      }
      i.archived = x.archived;
      return bump(i);
    },
    "dependency.add": (x, a) => {
      const i = issue(x.issueId, a);
      link(i, issue(x.requiresId, a));
      bump(i);
      return x;
    },
    "dependency.remove": (x, a) => {
      const i = issue(x.issueId, a);
      requireThat(
        !["In review", "Done"].includes(i.status),
        "invalid_transition",
        "Reopen the issue before changing prerequisites.",
      );
      requireThat(
        run(
          "DELETE FROM dependencies WHERE issue_id=? AND requires_id=?",
          x.issueId,
          x.requiresId,
        ).changes,
        "not_found",
        "Dependency not found.",
        404,
      );
      bump(i);
      return x;
    },
    "issue.claim": (x, a) => claim(issue(x.issueId, a), a),
    "issue.claimNext": (x, a) => {
      const p = project(x.projectId, a);
      requireThat(!p.archived, "archived", "Project is archived.");
      const row = get<{ id: string }>(
        `SELECT i.id FROM issues i WHERE project_id=? AND NOT archived AND status='Ready'
   AND json_extract(i.data,'$.type')!='epic' AND NOT ${blockedSql}
   AND NOT EXISTS(SELECT 1 FROM claims c WHERE c.issue_id=i.id AND c.data IS NOT NULL) ORDER BY priority,i.rowid LIMIT 1`,
        p.id,
      );
      return row ? claim(issue(row.id, a), a) : null;
    },
    "claim.heartbeat": (x, a) => {
      issue(x.issueId, a);
      const c = fence(x.issueId, a, x.generation);
      c.lastSeenAt = now();
      run("UPDATE claims SET data=? WHERE issue_id=?", encode(c), c.issueId);
      return c;
    },
    "claim.release": (x, a) => {
      const i = issue(x.issueId, a);
      fence(i.id, a, x.generation, true);
      move(i, "release");
      run("UPDATE claims SET data=NULL WHERE issue_id=?", i.id);
      return bump(i);
    },
    "claim.reassign": (x, a) => {
      const i = issue(x.issueId, a);
      fence(i.id, a, x.generation, true);
      const target = read<Credential>(
        "SELECT data FROM credentials WHERE id=? AND project_id=?",
        x.actorId,
        i.projectId,
      );
      requireThat(
        target?.kind === "agent" && !target.revoked,
        "invalid_actor",
        "Select an active agent for this project.",
      );
      if (i.status === "In review") {
        move(i, "changes");
        bump(i);
      }
      return reserve(i, x.actorId);
    },
    "comment.add": (x, a) => {
      const i = issue(x.issueId, a);
      if (a.kind === "agent") fence(i.id, a, x.generation);
      const c = {
        id: randomUUID(),
        issueId: i.id,
        actor: a.id,
        body: x.body,
        createdAt: now(),
      };
      run("INSERT INTO comments VALUES (?,?,?)", c.id, i.id, encode(c));
      return c;
    },
    "comment.list": (x, a) => {
      const i = issue(x.issueId, a);
      return page(
        "SELECT rowid cursor,data FROM comments WHERE issue_id=? AND rowid>? ORDER BY rowid LIMIT ?",
        [i.id],
        x,
        (r) => JSON.parse(r.data),
      );
    },
    "review.submit": (x, a) => {
      const i = issue(x.issueId, a);
      fence(i.id, a, x.generation);
      revision(x.expectedRevision, i.revision);
      requireThat(
        !i.blocked,
        "not_claimable",
        "Resolve blockers before submitting for review.",
      );
      requireThat(
        x.evidence.summary.trim() &&
          x.evidence.criteria.every((id) =>
            i.criteria.some((c) => c.id === id),
          ),
        "invalid_evidence",
        "Provide a summary and use current criterion IDs.",
        400,
      );
      move(i, "submit");
      i.criteria = i.criteria.map((c) => ({
        ...c,
        reported: x.evidence.criteria.includes(c.id),
        accepted: false,
      }));
      bump(i);
      const r: Review = {
        id: randomUUID(),
        issueId: i.id,
        actor: a.id,
        revision: i.revision,
        createdAt: now(),
        criteria: i.criteria,
        evidence: x.evidence,
        decision: null,
        reason: null,
        reviewer: null,
      };
      run("INSERT INTO reviews VALUES (?,?,?)", r.id, i.id, encode(r));
      return r;
    },
    "review.decide": (x, a) => {
      const r = read<Review>("SELECT data FROM reviews WHERE id=?", x.reviewId);
      requireThat(r, "not_found", "Submission not found.", 404);
      const i = issue(r.issueId, a);
      requireThat(
        r.actor !== a.id,
        "permission_denied",
        "A submitter cannot decide their own review.",
        403,
      );
      requireThat(
        !r.decision &&
          latest(i.id)?.id === r.id &&
          i.revision === r.revision &&
          i.status === "In review",
        "review_conflict",
        "This submission is no longer pending.",
      );
      if (x.decision === "approve")
        requireThat(
          !i.blocked && i.criteria.every((c) => c.reported),
          "review_conflict",
          "Resolve blockers and report all criteria before approval.",
        );
      move(i, x.decision);
      if (x.decision === "approve") {
        i.criteria = i.criteria.map((c) => ({ ...c, accepted: true }));
        run("UPDATE claims SET data=NULL WHERE issue_id=?", i.id);
      }
      bump(i);
      return decide(r, x.decision, x.reason, a.id);
    },
    "review.list": (x, a) => {
      if (x.projectId) scoped(a, x.projectId);
      const scope = x.projectId ?? a.projectId ?? null;
      return page(
        `SELECT r.rowid cursor,r.data FROM reviews r JOIN issues i ON i.id=r.issue_id WHERE (? IS NULL OR i.project_id=?) AND (? IS NULL OR (?=1)=(i.status='In review' AND json_extract(r.data,'$.decision') IS NULL AND json_extract(r.data,'$.revision')=json_extract(i.data,'$.revision'))) AND r.rowid>? ORDER BY r.rowid LIMIT ?`,
        [
          scope,
          scope,
          x.pending === undefined ? null : Number(x.pending),
          Number(x.pending ?? false),
        ],
        x,
        (r) => JSON.parse(r.data),
      );
    },
    "issue.context": (x, a) => {
      const i = issue(x.issueId, a);
      return {
        issue: i,
        claim: active(i.id),
        latestReview: latest(i.id),
        dependencies: all<{ requires_id: string }>(
          "SELECT requires_id FROM dependencies WHERE issue_id=? ORDER BY requires_id",
          i.id,
        ).map((d) => issue(d.requires_id, a)),
      };
    },
    "event.list": (x, a) => {
      if (x.projectId) scoped(a, x.projectId);
      const scope = x.projectId ?? a.projectId ?? null;
      return page(
        `SELECT sequence cursor,data FROM events WHERE (? IS NULL OR project_id=?) AND (? IS NULL OR json_extract(data,'$.entity')=?) AND sequence>? ORDER BY sequence LIMIT ?`,
        [scope, scope, x.entity ?? null, x.entity ?? null],
        x,
        (r) => ({ ...JSON.parse(r.data), sequence: r.cursor }),
      );
    },
    "credential.create": (x, a) => {
      project(x.projectId, a);
      const token = randomUUID() + randomUUID();
      const credential = {
        id: randomUUID(),
        projectId: x.projectId,
        kind: x.kind,
        revoked: false,
      };
      run(
        "INSERT INTO credentials VALUES (?,?,?,?)",
        credential.id,
        credential.projectId,
        hash(token),
        encode(credential),
      );
      return { credential, token };
    },
    "credential.list": (x, a) => {
      project(x.projectId, a);
      return page(
        "SELECT rowid cursor,data FROM credentials WHERE project_id=? AND rowid>? ORDER BY rowid LIMIT ?",
        [x.projectId],
        x,
        (r) => JSON.parse(r.data),
      );
    },
    "credential.revoke": (x, a) => {
      project(x.projectId, a);
      const c = read<Credential>(
        "SELECT data FROM credentials WHERE project_id=? AND id=?",
        x.projectId,
        x.credentialId,
      );
      requireThat(c, "not_found", "Credential not found.", 404);
      c.revoked = true;
      run("UPDATE credentials SET data=? WHERE id=?", encode(c), c.id);
      return c;
    },
    "project.export": (x, a) => {
      const p = project(x.projectId, a);
      const issues = records<Issue>(
        "SELECT data FROM issues WHERE project_id=? ORDER BY rowid LIMIT 1001",
        p.id,
      );
      const dependencies = all<{ issueId: string; requiresId: string }>(
        "SELECT d.issue_id issueId,d.requires_id requiresId FROM dependencies d JOIN issues i ON i.id=d.issue_id WHERE i.project_id=? ORDER BY d.rowid LIMIT 10001",
        p.id,
      );
      const comments = records<Comment>(
        "SELECT c.data FROM comments c JOIN issues i ON i.id=c.issue_id WHERE i.project_id=? ORDER BY c.rowid LIMIT 10001",
        p.id,
      );
      const reviews = records<Review>(
        "SELECT r.data FROM reviews r JOIN issues i ON i.id=r.issue_id WHERE i.project_id=? ORDER BY r.rowid LIMIT 10001",
        p.id,
      );
      const bundle = {
        version: 1 as const,
        name: p.name,
        issues,
        dependencies,
        comments,
        reviews,
      };
      requireThat(
        issues.length <= 1000 &&
          dependencies.length <= 10000 &&
          comments.length <= 10000 &&
          reviews.length <= 10000 &&
          Buffer.byteLength(encode(bundle)) < 3_500_000,
        "export_limit",
        "Portable export exceeds the supported size.",
        413,
      );
      return bundle;
    },
    "project.import": (x, a) => {
      const p = makeProject(x.name, x.prefix, null);
      const ids = new Map<string, Issue>();
      const keys = new Set<string>();
      const sourceProjects = new Set(x.data.issues.map((i) => i.projectId));
      requireThat(
        sourceProjects.size <= 1,
        "invalid_import",
        "Import must contain one project.",
        400,
      );
      const identities = new Set<string>();
      function historical(kind: string, id: string) {
        return "import-" + hash(p.id + ":" + kind + ":" + id).slice(0, 32);
      }
      function unique(kind: string, id: string) {
        const key = kind + ":" + id;
        requireThat(
          !identities.has(key),
          "invalid_import",
          "Duplicate imported identity.",
          400,
        );
        identities.add(key);
      }
      const remapped = x.data.issues.map((source, index) => {
        requireThat(
          !ids.has(source.id) && !keys.has(source.key),
          "invalid_import",
          "Duplicate issue ID or key.",
          400,
        );
        const i: Issue = {
          ...source,
          id: historical("issue", source.id),
          projectId: p.id,
          key: p.prefix + "-" + (index + 1),
          revision: 0,
          parentId: null,
          status: ["In progress", "In review"].includes(source.status)
            ? "Backlog"
            : source.status,
          criteria: source.criteria.map((c) => ({
            ...c,
            id: historical("criterion", c.id),
          })),
        };
        for (const c of source.criteria) unique("criterion", c.id);
        ids.set(source.id, i);
        keys.add(source.key);
        run(
          "INSERT INTO issues(id,project_id,data) VALUES (?,?,?)",
          i.id,
          p.id,
          encode(i),
        );
        return { from: source.id, to: i.id, key: i.key };
      });
      const resolve = (id: string) => {
        const i = ids.get(id);
        requireThat(i, "invalid_import", "Unknown issue in import.", 400);
        return i;
      };
      for (const source of x.data.issues)
        if (source.parentId) {
          const i = resolve(source.id);
          const pid = resolve(source.parentId).id;
          parent(i, pid);
          i.parentId = pid;
          save(i);
        }
      for (const d of x.data.dependencies) {
        const i = resolve(d.issueId);
        const required = resolve(d.requiresId);
        link({ ...i, status: "Backlog" }, required);
      }
      for (const c of x.data.comments) {
        unique("comment", c.id);
        const issueId = resolve(c.issueId).id;
        const id = historical("comment", c.id);
        run(
          "INSERT INTO comments VALUES (?,?,?)",
          id,
          issueId,
          encode({ ...c, id, issueId, actor: historical("actor", c.actor) }),
        );
      }
      for (const r of x.data.reviews) {
        unique("review", r.id);
        const issueId = resolve(r.issueId).id;
        const id = historical("review", r.id);
        const criteria = r.criteria.map((c) => ({
          ...c,
          id: historical("criterion", c.id),
        }));
        const evidence = {
          ...r.evidence,
          criteria: r.evidence.criteria.map((id) =>
            historical("criterion", id),
          ),
        };
        run(
          "INSERT INTO reviews VALUES (?,?,?)",
          id,
          issueId,
          encode({
            ...r,
            id,
            issueId,
            criteria,
            evidence,
            actor: historical("actor", r.actor),
            reviewer: r.reviewer ? historical("actor", r.reviewer) : null,
          }),
        );
      }
      run("UPDATE projects SET counter=? WHERE id=?", remapped.length, p.id);
      return { project: p, remapped };
    },
    "workspace.instructions": () => ({
      workflow:
        "Resolve the project. Read issue context and acceptance criteria. Claim ready work, report progress using your current claim generation, and submit checks and references. A human reviewer decides the outcome.",
    }),
  };
  function decide(
    r: Review,
    decision: Review["decision"],
    reason: string,
    reviewer: string,
  ) {
    const result = { ...r, decision, reason, reviewer };
    run("UPDATE reviews SET data=? WHERE id=?", encode(result), r.id);
    return result;
  }
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object")
      return (
        "{" +
        Object.entries(value)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => encode(key) + ":" + canonical(item))
          .join(",") +
        "}"
      );
    return encode(value);
  }
  function execute<K extends Operation>(
    operation: K,
    input: Input<K>,
    actor: Actor,
    key: string | undefined,
    validate: (output: unknown) => void,
  ): Output<K> {
    const meta = operations[operation];
    requireThat(
      meta.role === "any" ||
        meta.role === actor.kind ||
        (meta.role === "reviewer" && actor.kind === "owner"),
      "permission_denied",
      "Credential does not allow this operation.",
      403,
    );
    if (meta.method === "GET") {
      const output = handlers[operation](input, actor) as Output<K>;
      validate(output);
      return output;
    }
    return db
      .transaction(() => {
        const x = input as {
          projectId?: string;
          issueId?: string;
          reviewId?: string;
        };
        const reviewIssue = x.reviewId
          ? read<Review>("SELECT data FROM reviews WHERE id=?", x.reviewId)
              ?.issueId
          : undefined;
        const target = x.issueId ?? reviewIssue;
        const scope =
          x.projectId ??
          (target
            ? issue(target, actor).projectId
            : (actor.projectId ?? "workspace"));
        scoped(actor, scope);
        const requestHash = hash(canonical(input));
        if (key) {
          requireThat(
            operation !== "credential.create",
            "invalid_input",
            "Credential issuance does not accept an idempotency key.",
            400,
          );
          const prior = get<{ hash: string; result: string }>(
            "SELECT hash,result FROM requests WHERE actor=? AND scope=? AND operation=? AND key=?",
            actor.id,
            scope,
            operation,
            key,
          );
          if (prior) {
            requireThat(
              prior.hash === requestHash,
              "idempotency_conflict",
              "Key was already used with different input.",
            );
            const result = JSON.parse(prior.result);
            validate(result);
            return result;
          }
        }
        const output = handlers[operation](input, actor) as Output<K>;
        validate(output);
        const result = output as {
          id?: string;
          projectId?: string;
          issueId?: string;
          project?: Project;
        } | null;
        const eventProject =
          result?.projectId ??
          result?.project?.id ??
          (result?.issueId
            ? issue(result.issueId, actor).projectId
            : undefined) ??
          (operation.startsWith("project.") ? result?.id : undefined) ??
          (scope === "workspace" ? null : scope);
        const reason = (input as { reason?: string }).reason;
        const fields = Object.keys(input).filter(
          (key) =>
            ![
              "projectId",
              "issueId",
              "expectedRevision",
              "generation",
              "reason",
            ].includes(key),
        );
        if (output !== null)
          audit(
            actor,
            operation,
            result?.issueId ??
              result?.id ??
              x.issueId ??
              eventProject ??
              "workspace",
            eventProject,
            { fields, reason },
          );
        if (key)
          run(
            "INSERT INTO requests VALUES (?,?,?,?,?,?)",
            actor.id,
            scope,
            operation,
            key,
            requestHash,
            encode(output),
          );
        return output;
      })
      .immediate();
  }
  return {
    db,
    execute,
    authenticate(token: string): Actor | undefined {
      const credential = read<Credential>(
        "SELECT data FROM credentials WHERE hash=?",
        hash(token),
      );
      if (credential && !credential.revoked)
        return {
          id: credential.id,
          kind: credential.kind,
          projectId: credential.projectId,
        };
    },
  };
}
