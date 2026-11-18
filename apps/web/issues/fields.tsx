import type { Issue } from "../../../packages/contracts";
export function IssueFields({
  issue,
  candidates,
}: {
  issue?: Issue;
  candidates: Issue[];
}) {
  const epics = candidates.filter(
    (candidate) =>
      candidate.type === "epic" &&
      candidate.id !== issue?.id &&
      !candidate.archived,
  );
  const existing =
    issue?.parentId && !epics.some((epic) => epic.id === issue.parentId);
  return (
    <>
      <label className="field">
        Title
        <input
          name="title"
          defaultValue={issue?.title}
          required
          autoFocus
          maxLength={240}
        />
      </label>
      <label className="field">
        Description
        <textarea
          name="description"
          defaultValue={issue?.description}
          rows={4}
          maxLength={32000}
        />
      </label>
      <div className="form-pair">
        <label className="field">
          Type
          <select name="type" defaultValue={issue?.type ?? "task"}>
            <option value="task">Task</option>
            <option value="bug">Bug</option>
            <option value="epic">Epic</option>
          </select>
        </label>
        <label className="field">
          Priority
          <select name="priority" defaultValue={issue?.priority ?? "Medium"}>
            {["Low", "Medium", "High", "Urgent"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-pair">
        <label className="field">
          Assignee
          <input
            name="assignee"
            defaultValue={issue?.assignee ?? ""}
            maxLength={100}
          />
        </label>
        <label className="field">
          Labels
          <input
            name="labels"
            defaultValue={issue?.labels.join(", ")}
            placeholder="API, UI"
          />
        </label>
      </div>
      <label className="field">
        Parent epic
        <select name="parentId" defaultValue={issue?.parentId ?? ""}>
          <option value="">No parent</option>
          {epics.map((epic) => (
            <option key={epic.id} value={epic.id}>
              {epic.key} · {epic.title}
            </option>
          ))}
          {existing && (
            <option value={issue?.parentId ?? ""}>Current parent</option>
          )}
        </select>
      </label>
      <label className="field">
        Acceptance criteria <small>One criterion per line</small>
        <textarea
          name="criteria"
          rows={3}
          defaultValue={issue?.criteria.map((c) => c.text).join("\n")}
        />
      </label>
      <label className="field">
        Blocking reason
        <input
          name="blocker"
          defaultValue={issue?.blocker ?? ""}
          maxLength={1000}
        />
      </label>
    </>
  );
}
