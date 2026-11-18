import { Activity, Bot, Check, UserRound } from "lucide-react";
import type { Issue } from "../../../packages/contracts";
export const laneTone: Record<Issue["status"], string> = {
  Backlog: "#9fa8c8",
  Ready: "#40a8fb",
  "In progress": "#4ce3ef",
  "In review": "#b782ff",
  Done: "#51d98c",
  Canceled: "#fa858d",
};
export function Card({
  issue: i,
  selected,
  select,
}: {
  issue: Issue;
  selected: boolean;
  select: (id: string) => void;
}) {
  return (
    <button
      className={"card " + (selected ? "selected" : "")}
      aria-pressed={selected}
      onClick={() => select(i.id)}
    >
      <span className="card-key">
        {i.key}
        {i.status === "Done" ? (
          <Check size={15} className="done" />
        ) : (
          <i style={{ background: laneTone[i.status] }} />
        )}
      </span>
      <strong>{i.title}</strong>
      <span className="tags">
        <span className={"priority " + i.priority.toLowerCase()}>
          <Activity size={12} />
          {i.priority}
        </span>
        {i.labels.slice(0, 3).map((label, index) => (
          <span className="tag" key={label + index}>
            {label}
          </span>
        ))}
      </span>
      <span className="card-owner">
        {i.status === "In progress" ? (
          <Bot size={16} />
        ) : (
          <UserRound size={15} />
        )}{" "}
        {i.assignee ?? "Unassigned"}
      </span>
      {i.blocked && <span className="blocked">Blocked</span>}
    </button>
  );
}
