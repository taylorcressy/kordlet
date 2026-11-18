# Development workflow

Follow the [repository instructions](../../AGENTS.md) for approval boundaries and quota limits.

## Deliver a change

1. **Design.** Define the problem, scope, and acceptance criteria. For tracked work, read the ticket, dependencies, and relevant history. Check whether the work has already landed. Deliver one ticket per integration cycle and follow dependency order.
2. **Verify the starting point.** Inspect the implementation and existing checks. Reproduce the bug, record a baseline, or test the riskiest assumption.
3. **Build.** Make the smallest coherent change through the normal entry points. Update affected contracts, migrations, documentation, or runbooks alongside it.
4. **Verify locally.** Run focused checks during implementation and the applicable full local checks on the integrated change. Add targeted coverage when existing checks miss a meaningful regression. Exercise failure, retry, or compatibility behavior where relevant.
5. **Review and hand off.** Review the whole diff and record which checks cover each acceptance criterion, their outcomes, and any gaps. Stage only in-scope changes and make a coherent local commit when committing is in scope. Record the scope or ticket, affected revisions, outstanding approvals, and next owner or action.

## Worktrees and integration

Before creating a worktree, record its purpose, repository, path, branch, base, owner, and integration target. At handoff, inspect dirty files, unique commits, remote and pull request status, and verification evidence. Preserve dirty or unmerged work until its disposition is reviewed. After integration and validation, remove clean, reconciled worktrees using Git and audit the remaining work with `git worktree list --porcelain`.

Before closing a ticket, verify that the integrated revisions are reachable from the fetched remote integration branches, required CI and external gates have passed, and ticket worktrees are reconciled. Apply the owner's tracker write authorization. For releases, record the revision, gate evidence, approvals, and any outstanding verification with its owner.

For incidents, record symptoms, the root cause or current hypothesis, containment, supported recovery, verification, and prevention. Apply the repository approval rules before recovery.

## Open decisions

- Authoritative tracker and project, including who may update or close tickets.
- Remote and integration branch, local build and test commands, and any required CI or release gates.
- Deployment targets and supported release procedures.
- Optional delegation. If the owner approves the tools and the data they can receive, consider Grok for scoped frontend work and Claude for bounded coding or review within included quota. Assign explicit file ownership and acceptance criteria. The primary agent reviews the diff and runs local checks. Use the primary agent when delegation has no agreed authorization or tooling.
