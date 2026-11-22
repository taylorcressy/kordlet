import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownUp,
  Bot,
  Check,
  ChevronDown,
  ClipboardCheck,
  Columns3,
  Folder,
  Inbox,
  Layers3,
  List,
  Monitor,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
import "@fontsource-variable/inter";
import "./style.css";
import { apiClient, ApiError } from "../../packages/client";
import {
  product,
  statuses,
  type Issue,
  type Input,
  type Output,
  type Project,
} from "../../packages/contracts";
import { loadDemo } from "./board/demo";
import { Card, laneTone } from "./board/card";
import { Detail } from "./issues/detail";
import { IssueFields } from "./issues/fields";
const call = apiClient();
const lanes = statuses.slice(0, 5);
const navigation = [
  ["Projects", Folder],
  ["Inbox", Inbox],
  ["Board", Columns3],
  ["List", List],
  ["Review", ClipboardCheck],
  ["Agents", Bot],
  ["Settings", Settings],
] as const;
type View = (typeof navigation)[number][0];
type Filter =
  | "All"
  | "Ready"
  | "Mine"
  | "Blocked"
  | "Needs review"
  | "Archived"
  | "Canceled";
type Context = Output<"issue.context">;
function App() {
  const [view, setView] = useState<View>("Board");
  const [filter, setFilter] = useState<Filter>("All");
  const [search, setSearch] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProject] = useState("");
  const project = projects.find((p) => p.id === projectId);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selected, select] = useState("");
  const [context, setContext] = useState<Context | null>(null);
  const [comments, setComments] = useState<Output<"comment.list">["items"]>([]);
  const [events, setEvents] = useState<Output<"event.list">["items"]>([]);
  const [credentials, setCredentials] = useState<
    Output<"credential.list">["items"]
  >([]);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [light, setLight] = useState(
    localStorage.getItem("kordlet-theme") === "light",
  );
  const [modal, setModal] = useState<
    "issue" | "project" | "edit" | "project-edit" | "project-delete" | null
  >(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [newStatus, setNewStatus] = useState<Issue["status"]>("Backlog");
  const [filters, setFilters] = useState(false);
  const [token, setToken] = useState("");
  const [refresh, reload] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const editorTrigger = useRef<HTMLElement | null>(null);
  const boot = useRef<Promise<void> | null>(null);
  const report = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    if (e instanceof ApiError && e.failure.code === "service_unavailable")
      setOnline(false);
  }, []);
  const openEditor = useCallback(
    (
      kind: "issue" | "project" | "edit" | "project-edit",
      status: Issue["status"] = "Backlog",
    ) => {
      editorTrigger.current = document.activeElement as HTMLElement;
      setNewStatus(status);
      setModal(kind);
    },
    [],
  );
  function closeEditor() {
    setModal(null);
    editorTrigger.current?.focus();
  }
  const update = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      setError("");
      try {
        await action();
        reload((x) => x + 1);
      } catch (e) {
        report(e);
      } finally {
        setBusy(false);
      }
    },
    [report],
  );
  useEffect(() => {
    if (!boot.current) {
      const launch = new URLSearchParams(location.hash.slice(1)).get("launch");
      if (launch) history.replaceState(null, "", location.pathname);
      boot.current = (async () => {
        if (!launch) return;
        const response = await fetch("/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: launch }),
        });
        if (!response.ok) throw Error((await response.json()).message);
      })();
    }
    let active = true;
    boot.current
      .then(() => call("project.list", {}))
      .then((result) => {
        if (!active) return;
        setProjects(result.items);
        setProject(
          (current) =>
            result.items.some((item) => item.id === current)
              ? current
              : result.items.find((item) => !item.archived)?.id || "",
        );
        setOnline(navigator.onLine);
      })
      .catch((e) => {
        if (active) report(e);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh, report]);
  const query: Input<"issue.list"> = {
    projectId,
    status:
      filter === "Needs review" || view === "Inbox" || view === "Review"
        ? "In review"
        : filter === "Canceled"
          ? "Canceled"
          : undefined,
    search: search.trim() || undefined,
    blocked: filter === "Blocked" || undefined,
    ready: filter === "Ready" || undefined,
    mine: filter === "Mine" || undefined,
    archived: filter === "Archived" || undefined,
    limit: 100,
  };
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    if (!projectId) {
      setIssues([]);
      setCursor(null);
      return;
    }
    let active = true;
    const run = async () => {
      try {
        const [result, reviews] = await Promise.all([
          call("issue.list", JSON.parse(queryKey)),
          call("review.list", { projectId, pending: true, limit: 100 }),
        ]);
        if (active) {
          setIssues(result.items);
          setCursor(result.cursor);
          setPending(reviews.items.length);
          setOnline(navigator.onLine);
        }
      } catch (e) {
        if (active) report(e);
      }
    };
    const timer = setTimeout(() => void run(), search ? 180 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [projectId, queryKey, refresh, report, search]);
  useEffect(() => {
    if (!selected) {
      setContext(null);
      setComments([]);
      setEvents([]);
      return;
    }
    let active = true;
    Promise.all([
      call("issue.context", { issueId: selected }),
      call("comment.list", { issueId: selected }),
      call("event.list", { projectId, entity: selected, limit: 100 }),
    ])
      .then(([c, notes, history]) => {
        if (active) {
          setContext(c);
          setComments(notes.items);
          setEvents(
            history.items
              .filter((e) => e.entity === selected)
              .reverse()
              .slice(0, 5),
          );
        }
      })
      .catch((e) => {
        if (active) report(e);
      });
    return () => {
      active = false;
    };
  }, [selected, projectId, refresh, report]);
  useEffect(() => {
    if (view !== "Agents" || !projectId) return;
    let active = true;
    call("credential.list", { projectId })
      .then((c) => {
        if (active) setCredentials(c.items);
      })
      .catch((e) => {
        if (active) report(e);
      });
    return () => {
      active = false;
    };
  }, [view, projectId, refresh, report]);
  useEffect(() => {
    const offline = () => setOnline(false);
    const reconnect = () => reload((x) => x + 1);
    window.addEventListener("offline", offline);
    window.addEventListener("online", reconnect);
    return () => {
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", reconnect);
    };
  }, []);
  useEffect(() => {
    let active = true;
    let stream: EventSource | undefined;
    void boot.current?.then(() => {
      if (!active) return;
      stream = new EventSource("/stream");
      stream.onopen = () => {
        setOnline(navigator.onLine);
        reload((x) => x + 1);
      };
      stream.onmessage = () => reload((x) => x + 1);
      stream.onerror = () => setOnline(false);
    }).catch(report);
    return () => {
      active = false;
      stream?.close();
    };
  }, [report]);
  useEffect(() => {
    if (modal && !dialog.current?.open) dialog.current?.showModal();
    if (!modal && dialog.current?.open) dialog.current?.close();
  }, [modal]);
  useEffect(() => {
    document.documentElement.dataset.theme = light ? "light" : "dark";
    localStorage.setItem("kordlet-theme", light ? "light" : "dark");
  }, [light]);
  useEffect(() => {
    const action = (e: KeyboardEvent) => {
      const writing = (e.target as HTMLElement)?.matches(
        "input, textarea, select, [contenteditable]",
      );
      if (
        (e.key === "k" && (e.metaKey || e.ctrlKey)) ||
        (e.key === "/" && !writing)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && !modal) {
        select("");
        setFilters(false);
      }
      if (
        e.key === "n" &&
        !writing &&
        !e.ctrlKey &&
        !e.metaKey &&
        !modal &&
        online
      )
        openEditor(projectId ? "issue" : "project");
    };
    window.addEventListener("keydown", action);
    return () => window.removeEventListener("keydown", action);
  }, [modal, openEditor, online, projectId]);
  const readyCount = issues.filter(
    (i) => i.status === "Ready" && !i.blocked && i.type !== "epic",
  ).length;
  const changeProject = (id: string) => {
    setProject(id);
    select("");
    setFilter("All");
    setToken("");
  };
  const issue = context?.issue;
  const subset = issues.filter(
    (i) => i.status !== "Canceled" || filter === "Canceled",
  );
  const newIssue = () => openEditor(project ? "issue" : "project");
  const createDemo = () =>
    update(async () => {
      const demo = await loadDemo(call);
      changeProject(demo.project.id);
      select(demo.selected);
      setView("Board");
    });
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const str = (key: string) => String(form.get(key) ?? "");
    await update(async () => {
      if (modal === "project-delete") {
        if (!projectToDelete) return;
        const response = await fetch("/session/projects/" + encodeURIComponent(projectToDelete.id) + "/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: projectToDelete.revision,
            confirmation: str("confirmation"),
          }),
        });
        if (!response.ok) throw new ApiError(await response.json());
        changeProject("");
        setView("Projects");
      } else if (modal === "project-edit" && project) {
        await call("project.update", {
          projectId: project.id,
          expectedRevision: project.revision,
          name: str("name"),
          repository: str("repository") || null,
          archived: form.get("archived") === "on",
        });
      } else if (modal === "project") {
        const next = await call("project.create", {
          name: str("name"),
          prefix: str("prefix").toUpperCase(),
          ...(str("repository") ? { repository: str("repository") } : {}),
        });
        changeProject(next.id);
        setView("Board");
      } else {
        const data = {
          title: str("title"),
          description: str("description"),
          type: str("type") as Issue["type"],
          priority: str("priority") as Issue["priority"],
          assignee: str("assignee") || null,
          labels: str("labels")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          criteria: str("criteria")
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          blocker: str("blocker") || null,
          parentId: str("parentId") || null,
        };
        if (modal === "edit" && issue)
          await call("issue.update", {
            issueId: issue.id,
            expectedRevision: issue.revision,
            ...data,
          });
        else {
          const next = await call("issue.create", { projectId, ...data });
          if (newStatus === "Ready")
            await call("issue.transition", {
              issueId: next.id,
              expectedRevision: next.revision,
              status: "Ready",
            });
          select(next.id);
        }
      }
      closeEditor();
    });
  }
  const selectIssue = (id: string) => {
    if (id !== selected) {
      setContext(null);
      setComments([]);
      setEvents([]);
      select(id);
    }
  };
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <div className="brandmark">K</div>
          <div>
            <strong>{product.name}</strong>
            <span>Local issue tracker</span>
          </div>
        </div>
        <nav aria-label="Workspace">
          <div className="nav-caption">Workspace</div>
          {navigation.map(([name, Icon]) => (
            <button
              key={name}
              aria-label={name}
              className={view === name ? "nav active" : "nav"}
              aria-current={view === name ? "page" : undefined}
              onClick={() => {
                setView(name);
                setFilter("All");
                select("");
              }}
            >
              <Icon size={18} />
              <span>{name}</span>
              {name === "Inbox" && pending > 0 && <b>{pending}</b>}
            </button>
          ))}
        </nav>
        <div className="rail-status">
          <Monitor size={20} />
          <div>
            <strong>
              <i className={online ? "online" : "offline"} />
              {online ? "Local mode" : "Offline"}
            </strong>
            <small>{online ? "Running locally" : "Service disconnected"}</small>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="bar">
          <label className="search">
            <Search size={17} />
            <input
              ref={searchRef}
              aria-label="Search issues"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => {
                if (!["Board", "List", "Inbox", "Review"].includes(view))
                  setView("List");
              }}
              placeholder="Search issues by title or key…"
            />
            <kbd>⌘ K</kbd>
          </label>
          <button className="primary" onClick={newIssue} disabled={!online}>
            <Plus size={17} /> New
          </button>
          <div className="filter-control">
            <button
              aria-expanded={filters}
              onClick={() => setFilters(!filters)}
            >
              <SlidersHorizontal size={16} />
              <span>Filters</span>
              <ChevronDown size={14} />
            </button>
            {filters && (
              <div className="filter-menu">
                {(
                  [
                    "All",
                    "Ready",
                    "Mine",
                    "Blocked",
                    "Needs review",
                    "Archived",
                    "Canceled",
                  ] as const
                ).map((value) => (
                  <button
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => {
                      setFilter(value);
                      setFilters(false);
                      if (!["Board", "List"].includes(view)) setView("List");
                    }}
                  >
                    {value}
                    {filter === value && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="project-select">
            <Layers3 size={17} />
            <select
              aria-label="Project"
              value={projectId}
              onChange={(e) => changeProject(e.target.value)}
            >
              {!project && <option value="">Select a project</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className={"connection " + (online ? "" : "bad")}
            onClick={() => {
              setError("");
              reload((x) => x + 1);
            }}
            title="Reconnect to local service"
          >
            <i className={online ? "online" : "offline"} />
            {online ? "Local mode" : "Reconnect"}
            <Activity size={16} />
          </button>
        </header>
        {error && (
          <div role="alert" className="alert">
            {error}
            <button
              className="icon"
              aria-label="Dismiss error"
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className={"body " + (selected ? "inspecting" : "")}>
          <main className="main">
            <div className="heading">
              <div>
                <div className="project-label">
                  <Layers3 size={17} />
                  {project?.name ?? "Workspace"}
                </div>
                <h1>
                  {view === "Board"
                    ? "Boardroom"
                    : view === "Inbox"
                      ? "Review inbox"
                      : view === "List"
                        ? "Issues"
                        : view}
                </h1>
                <p>
                  {view === "Board"
                    ? "Plan, build, and review work in one local workspace."
                    : view === "Inbox" || view === "Review"
                      ? "Inspect submitted evidence and decide what ships."
                      : view === "List"
                        ? "Find and organize issues across the workflow."
                        : ""}
                </p>
              </div>
              {project && ["Board", "List"].includes(view) && (
                <div className="summary">
                  <span>
                    <Layers3 size={16} /> {issues.length}
                    {cursor !== null ? "+" : ""} issues
                  </span>
                  <button
                    onClick={() =>
                      setFilter(filter === "Ready" ? "All" : "Ready")
                    }
                  >
                    <Activity size={16} /> {readyCount} ready
                  </button>
                  <button
                    onClick={() => {
                      setView("Inbox");
                      setFilter("All");
                    }}
                  >
                    <ClipboardCheck size={16} /> {pending} in review
                  </button>
                </div>
              )}
            </div>
            {filter !== "All" && (
              <button
                className="active-filter"
                onClick={() => setFilter("All")}
              >
                {filter}
                <X size={13} />
              </button>
            )}
            {loading ? (
              <div className="empty" role="status">
                Loading workspace…
              </div>
            ) : view === "Settings" ? (
              <section className="panel settings">
                <h2>Appearance</h2>
                <label>
                  Theme{" "}
                  <select
                    value={light ? "light" : "dark"}
                    onChange={(e) => setLight(e.target.value === "light")}
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </label>
                {project && (
                  <>
                    <h2>Project</h2>
                    <button
                      disabled={!online}
                      onClick={() => openEditor("project-edit")}
                    >
                      Edit {project.name}
                    </button>
                    <p>{project.repository ?? "No repository linked"}</p>
                  </>
                )}
                <h2>Local service</h2>
                <p>{online ? "Connected" : "Offline"}</p>
                <p>
                  Run <code>kordlet open</code> for a fresh browser session or{" "}
                  <code>kordlet serve</code> to start the service.
                </p>
              </section>
            ) : view === "Projects" ? (
              <section className="panel">
                <button
                  className="primary"
                  onClick={() => openEditor("project")}
                >
                  <Plus size={16} /> New project
                </button>
                {projects.map((p) => (
                  <button
                    aria-current={p.id === projectId ? "true" : undefined}
                    className="project-row"
                    key={p.id}
                    onClick={() => {
                      changeProject(p.id);
                      setView("Board");
                    }}
                  >
                    <Folder size={18} />
                    <strong>{p.name}</strong>
                    <span>
                      {p.prefix}
                      {p.archived ? " · Archived" : ""}
                    </span>
                  </button>
                ))}
              </section>
            ) : !project ? (
              <section className="empty">
                <Layers3 size={32} />
                <h2>Create your first project</h2>
                <p>
                  Add a space for your issues, or explore a sample Boardroom.
                </p>
                <div>
                  <button
                    className="primary"
                    onClick={() => openEditor("project")}
                    disabled={busy || !online}
                  >
                    <Plus size={16} /> New project
                  </button>
                  <button
                    onClick={() => void createDemo()}
                    disabled={busy || !online}
                  >
                    Load demo project
                  </button>
                </div>
              </section>
            ) : view === "Agents" ? (
              <section className="panel">
                <h2>Project credentials</h2>
                <p>
                  Use a scoped agent credential to claim issues and submit
                  evidence.
                </p>
                <button
                  onClick={() =>
                    void update(async () =>
                      setToken(
                        (
                          await call("credential.create", {
                            projectId,
                            kind: "agent",
                          })
                        ).token,
                      ),
                    )
                  }
                  disabled={busy || !online}
                >
                  <Plus size={16} /> Create agent credential
                </button>
                {token && (
                  <label className="field">
                    Copy this token once
                    <input
                      readOnly
                      value={token}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                )}
                {credentials.map((c) => (
                  <div className="project-row" key={c.id}>
                    <Bot size={17} />
                    <code>{c.id}</code>
                    <span>{c.revoked ? "Revoked" : c.kind}</span>
                    {!c.revoked && (
                      <button
                        onClick={() =>
                          void update(() =>
                            call("credential.revoke", {
                              projectId,
                              credentialId: c.id,
                            }),
                          )
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </section>
            ) : view === "Board" &&
              !["Archived", "Canceled"].includes(filter) ? (
              <div className="board" aria-label="Issue board">
                {lanes.map((status) => {
                  const cards = subset.filter((i) => i.status === status);
                  return (
                    <section className="lane" key={status} aria-label={status}>
                      <h2>
                        <i style={{ background: laneTone[status] }} />
                        {status}
                        <span>{cards.length}</span>
                      </h2>
                      {cards.map((i) => (
                        <Card
                          key={i.id}
                          issue={i}
                          selected={i.id === selected}
                          select={selectIssue}
                        />
                      ))}
                      {(status === "Backlog" || status === "Ready") && (
                        <button
                          className="add"
                          onClick={() => openEditor("issue", status)}
                          disabled={!online}
                        >
                          <Plus size={15} /> Add issue
                        </button>
                      )}
                      {!cards.length &&
                        status !== "Backlog" &&
                        status !== "Ready" && (
                          <p className="lane-empty">No issues</p>
                        )}
                    </section>
                  );
                })}
              </div>
            ) : (
              <section className="list" aria-label="Issue list">
                {subset.length ? (
                  <>
                    <div className="list-header">
                      <span>Issue</span>
                      <span>Status</span>
                      <span>
                        Priority <ArrowDownUp size={12} />
                      </span>
                    </div>
                    {subset.map((i) => (
                      <button
                        className={
                          "row " + (i.id === selected ? "selected" : "")
                        }
                        key={i.id}
                        onClick={() => selectIssue(i.id)}
                      >
                        <span>
                          <small>{i.key}</small>
                          {i.title}
                        </span>
                        <span>{i.status}</span>
                        <span
                          className={"priority " + i.priority.toLowerCase()}
                        >
                          {i.priority}
                        </span>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="empty">
                    <Inbox size={27} />
                    <h2>
                      {view === "Inbox" || view === "Review"
                        ? "No pending reviews"
                        : "No matching issues"}
                    </h2>
                  </div>
                )}
              </section>
            )}
            {cursor !== null && (
              <button
                className="more"
                onClick={() =>
                  void call("issue.list", { ...query, cursor })
                    .then((page) => {
                      setIssues((old) => [...old, ...page.items]);
                      setCursor(page.cursor);
                    })
                    .catch(report)
                }
              >
                Load more issues
              </button>
            )}
          </main>
          {selected && (
            <aside className="inspector" aria-label="Issue details">
              {issue && context ? (
                <Detail
                  context={context}
                  issues={issues}
                  events={events}
                  comments={comments}
                  close={() => select("")}
                  select={selectIssue}
                  edit={() => openEditor("edit")}
                  update={update}
                  disabled={busy || !online}
                />
              ) : (
                <div className="detail-top">
                  <span role="status">Loading issue…</span>
                  <button
                    className="icon"
                    aria-label="Close details"
                    onClick={() => select("")}
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
      <dialog
        ref={dialog}
        onCancel={(e) => {
          e.preventDefault();
          closeEditor();
        }}
      >
        {modal && (
          <form onSubmit={(e) => void save(e)} key={modal}>
            <div className="detail-top">
              <h2>
                {modal === "project"
                  ? "New project"
                  : modal === "edit"
                    ? "Edit issue"
                    : modal === "project-edit"
                      ? "Edit project"
                      : modal === "project-delete"
                        ? "Delete project"
                        : "New issue"}
              </h2>
              <button
                type="button"
                className="icon"
                aria-label="Close dialog"
                onClick={closeEditor}
              >
                <X size={20} />
              </button>
            </div>
            {modal === "project-delete" && projectToDelete ? (
              <>
                <p>Permanently delete <strong>{projectToDelete.name}</strong> and its Kordlet data, including issues, reviews, comments, and project credentials.</p>
                <label className="field">
                  Type the project name
                  <input name="confirmation" autoFocus required maxLength={240} autoComplete="off" />
                </label>
              </>
            ) : modal === "project" || modal === "project-edit" ? (
              <>
                <label className="field">
                  Name
                  <input
                    name="name"
                    required
                    autoFocus
                    maxLength={240}
                    defaultValue={
                      modal === "project-edit" ? project?.name : undefined
                    }
                  />
                </label>
                {modal === "project" && (
                  <label className="field">
                    Issue key prefix
                    <input
                      name="prefix"
                      required
                      minLength={2}
                      maxLength={10}
                      pattern="[A-Za-z][A-Za-z0-9]{1,9}"
                      placeholder="KOR"
                    />
                  </label>
                )}
                <label className="field">
                  Repository path
                  <input
                    name="repository"
                    defaultValue={
                      modal === "project-edit"
                        ? (project?.repository ?? "")
                        : ""
                    }
                  />
                </label>
                {modal === "project-edit" && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      name="archived"
                      defaultChecked={project?.archived}
                    />{" "}
                    Archive project
                  </label>
                )}
              </>
            ) : (
              <IssueFields
                issue={modal === "edit" ? issue : undefined}
                candidates={issues}
              />
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="actions">
              {modal === "project-edit" && (
                <button type="button" className="danger" disabled={!project || !online || busy} onClick={() => {
                  setProjectToDelete(project ?? null);
                  setModal("project-delete");
                }}>
                  Delete project…
                </button>
              )}
              <button type="button" onClick={closeEditor}>
                Cancel
              </button>
              <button className={modal === "project-delete" ? "danger" : "primary"} disabled={!online || busy}>
                {modal === "project-delete" ? "Permanently delete" : modal === "edit" || modal === "project-edit"
                  ? "Save changes"
                  : modal === "project"
                    ? "Create project"
                    : "Create issue"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
