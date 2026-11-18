import { useState, useEffect } from "react";
import {
  Activity,
  Archive,
  Bot,
  Check,
  CircleHelp,
  ClipboardCheck,
  GitBranch,
  Inbox,
  List,
  UserRound,
  X,
} from "lucide-react";
import Markdown from "react-markdown";
import { apiClient } from "../../../packages/client";
import type { Input, Output, Issue } from "../../../packages/contracts";
import { laneTone } from "../board/card";
const call = apiClient();
type Context = Output<"issue.context">;
type DetailProps = {
  context: Context;
  issues: Issue[];
  events: Output<"event.list">["items"];
  comments: Output<"comment.list">["items"];
  close: () => void;
  select: (id: string) => void;
  edit: () => void;
  update: (action: () => Promise<unknown>) => Promise<void>;
  disabled: boolean;
};
export function Detail({
  context: { issue: i, claim, latestReview: r, dependencies },
  issues,
  events,
  comments,
  close,
  select,
  edit,
  update,
  disabled,
}: DetailProps) {
  const [dependency, setDependency] = useState("");
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    setComment("");
    setReason("");
    setDependency("");
  }, [i.id]);
  const pending =
    i.status === "In review" && r?.revision === i.revision && !r.decision;
  const canEdit = !i.archived && !["Done", "Canceled"].includes(i.status);
  const canLink = canEdit && i.status !== "In review";
  const opts = issues.filter(
    (candidate) =>
      candidate.id !== i.id && !dependencies.some((d) => d.id === candidate.id),
  );
  const action = (fn: () => Promise<unknown>) => () => void update(fn);
  return (
    <>
      <div className="detail-top">
        <span>
          <GitBranch size={16} />
          {i.key}
        </span>
        <button className="icon" aria-label="Close details" onClick={close}>
          <X size={19} />
        </button>
      </div>
      <h2>{i.title}</h2>
      <div className="tags">
        <span className="status-tag" style={{ color: laneTone[i.status] }}>
          {i.status}
        </span>
        <span className={"priority " + i.priority.toLowerCase()}>
          <Activity size={12} />
          {i.priority}
        </span>
        {i.labels.map((label, index) => (
          <span className="tag" key={label + index}>
            {label}
          </span>
        ))}
        {i.blocked && <span className="blocked">Blocked</span>}
      </div>
      <dl>
        <dt>Assignee</dt>
        <dd>
          <UserRound size={14} />
          {i.assignee ?? "Unassigned"}
        </dd>
        <dt>Claim status</dt>
        <dd>
          {claim ? (
            <span className="claimed">
              <Bot size={13} />
              {claim.actor === "local-owner" ? "Claimed by you" : "Agent claim"}
            </span>
          ) : (
            "Unclaimed"
          )}
        </dd>
        {claim && (
          <>
            <dt>Last reported</dt>
            <dd>{new Date(claim.lastSeenAt).toLocaleString()}</dd>
          </>
        )}
        <dt>Type</dt>
        <dd>{i.type}</dd>
      </dl>
      <div className="detail-actions">
        {canEdit && (
          <button disabled={disabled} onClick={edit}>
            Edit issue
          </button>
        )}
        {!i.archived && !claim && i.status !== "In review" && (
          <select
            aria-label="Move issue"
            value=""
            disabled={disabled}
            onChange={(e) => {
              const status = e.target
                .value as Input<"issue.transition">["status"];
              if (status)
                void update(() =>
                  call("issue.transition", {
                    issueId: i.id,
                    expectedRevision: i.revision,
                    status,
                  }),
                );
            }}
          >
            <option value="">Move issue</option>
            {(["Backlog", "Ready", "Canceled"] as const)
              .filter((status) => status !== i.status)
              .map((status) => (
                <option key={status}>{status}</option>
              ))}
          </select>
        )}
        {!i.archived &&
          !claim &&
          !i.blocked &&
          ["Backlog", "Ready", "In progress"].includes(i.status) && (
            <button
              disabled={disabled}
              onClick={action(() =>
                call("issue.complete", {
                  issueId: i.id,
                  expectedRevision: i.revision,
                }),
              )}
            >
              Mark done
            </button>
          )}
        {!claim && (
          <button
            disabled={disabled}
            title={i.archived ? "Unarchive" : "Archive"}
            aria-label={i.archived ? "Unarchive" : "Archive"}
            onClick={action(() =>
              call("issue.archive", {
                issueId: i.id,
                expectedRevision: i.revision,
                archived: !i.archived,
              }),
            )}
          >
            <Archive size={15} />
          </button>
        )}
      </div>
      <section>
        <h3>
          <List size={16} /> Description
        </h3>
        {i.description ? (
          <div className="markdown">
            <Markdown
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
                img: ({ alt }) => <span>{alt}</span>,
              }}
            >
              {i.description}
            </Markdown>
          </div>
        ) : (
          <p className="muted">No description</p>
        )}
      </section>
      <section>
        <h3>
          <ClipboardCheck size={16} /> Acceptance criteria
        </h3>
        {i.criteria.length ? (
          <ul className="criteria">
            {i.criteria.map((c) => (
              <li key={c.id}>
                <span
                  className={c.accepted || c.reported ? "tick checked" : "tick"}
                >
                  {(c.accepted || c.reported) && <Check size={12} />}
                </span>
                <span>
                  {c.text}
                  {c.accepted
                    ? " · Accepted"
                    : c.reported
                      ? " · Reported complete"
                      : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No acceptance criteria</p>
        )}
      </section>
      <section>
        <h3>
          <GitBranch size={16} /> Dependencies{" "}
          <span className="count">{dependencies.length}</span>
        </h3>
        {i.blocker && <p className="blocked">{i.blocker}</p>}
        {dependencies.map((d) => (
          <div className="dependency" key={d.id}>
            <button onClick={() => select(d.id)}>
              <span>{d.key}</span> {d.title}{" "}
              {d.status === "Done" && !d.archived && <Check size={14} />}
            </button>
            {canLink && (
              <button
                aria-label={"Remove " + d.key}
                className="icon"
                disabled={disabled}
                onClick={action(() =>
                  call("dependency.remove", {
                    issueId: i.id,
                    requiresId: d.id,
                  }),
                )}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        {canLink && opts.length > 0 && (
          <div className="inline-form">
            <select
              aria-label="Prerequisite issue"
              value={dependency}
              onChange={(e) => setDependency(e.target.value)}
            >
              <option value="">Choose prerequisite</option>
              {opts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.key} · {d.title}
                </option>
              ))}
            </select>
            <button
              disabled={disabled || !dependency}
              onClick={action(async () => {
                await call("dependency.add", {
                  issueId: i.id,
                  requiresId: dependency,
                });
                setDependency("");
              })}
            >
              Add
            </button>
          </div>
        )}
      </section>
      {r && (
        <section>
          <h3>
            <Inbox size={16} /> Review evidence
          </h3>
          <p className="muted">Agent-reported · Revision {r.revision}</p>
          <p>{r.evidence.summary}</p>
          {r.evidence.checks.map((check, n) => (
            <p key={n}>
              <code>{check}</code>
            </p>
          ))}
          {r.evidence.references.map((ref, n) => (
            <p key={n}>
              <code>{ref}</code>
            </p>
          ))}
          {r.evidence.limitations && <p>{r.evidence.limitations}</p>}
          {r.decision && (
            <p>
              {r.decision === "approve" ? "Approved" : "Changes requested"} ·{" "}
              {r.reason}
            </p>
          )}
          {pending && (
            <>
              <label className="field">
                Decision reason
                <textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={240}
                />
              </label>
              <div className="actions">
                <button
                  disabled={disabled || !reason.trim()}
                  onClick={action(() =>
                    call("review.decide", {
                      reviewId: r.id,
                      decision: "changes",
                      reason,
                    }),
                  )}
                >
                  Request changes
                </button>
                <button
                  className="primary"
                  disabled={disabled || !reason.trim()}
                  onClick={action(() =>
                    call("review.decide", {
                      reviewId: r.id,
                      decision: "approve",
                      reason,
                    }),
                  )}
                >
                  Approve
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {claim && (
        <section>
          <h3>
            <CircleHelp size={16} /> Claim recovery
          </h3>
          <label className="field">
            Release reason
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={240}
            />
          </label>
          <button
            disabled={disabled || !reason.trim()}
            onClick={action(() =>
              call("claim.release", {
                issueId: i.id,
                generation: claim.generation,
                reason,
              }),
            )}
          >
            Release claim
          </button>
        </section>
      )}
      <section>
        <h3>
          <Activity size={16} /> Recent activity
        </h3>
        {events.length ? (
          <ul className="timeline">
            {events.map((event) => (
              <li key={event.sequence}>
                <span>{event.operation.replaceAll(".", " ")}</span>
                <time dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No activity yet</p>
        )}
      </section>
      <section>
        <h3>Comments</h3>
        {comments.map((c) => (
          <div key={c.id} className="comment">
            <small>
              {c.actor === "local-owner" ? "Owner" : "Agent"} ·{" "}
              {new Date(c.createdAt).toLocaleString()}
            </small>
            <p>{c.body}</p>
          </div>
        ))}
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void update(async () => {
              await call("comment.add", { issueId: i.id, body: comment });
              setComment("");
            });
          }}
        >
          <input
            aria-label="Comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment"
          />
          <button disabled={disabled || !comment.trim()}>Post</button>
        </form>
      </section>
    </>
  );
}
