# User and agent guide

Create a project with a unique issue prefix such as KOR. Optionally enter a local repository path. Projects and issues are stored immediately and are visible to authenticated CLI and MCP clients.

Use **Board** to see work by status and **List** to search and filter. Press `N` to create an issue, `/` or Ctrl/Cmd+K to focus search, and Escape to close the current inspector or dialog. Open a card to edit its title, Markdown description, acceptance criteria, priority, assignee, labels, and explicit blocking reason. The inspector links prerequisites and shows why work cannot proceed. Scope is per workspace, with one workspace per data directory.

Move a task or bug to Ready to make it available for claims when its prerequisites are Done and it has no explicit blocker. An epic groups issues and is ineligible for claims. Archived and canceled prerequisites remain blocking until resolved. The owner can mark ordinary unclaimed human work Done directly. Reopening to Ready clears current acceptance and preserves review history.

A claim is a durable reservation tied to a credential and generation. It remains active during review. Last reported activity records an explicit heartbeat and does not measure process liveness. Release or reassign with a reason when recovering an abandoned reservation. Claim changes fence old generations. The inbox shows pending submissions and separates reported completion from accepted criteria. Approval applies to the exact revision and submission. Request changes keeps ownership so the agent can resubmit.

## CLI and MCP

Kordlet serves only on loopback. The CLI discovers a validated service from the current data directory. Start it with `kordlet serve` if it is offline. `kordlet open --json` prints a short-lived session link. The browser removes the launch fragment after use. The default CLI credential is the protected local owner token. Use `--profile` for an installed agent credential, or set `KORDLET_TOKEN` in a trusted environment to use an explicitly issued token.

```sh
kordlet api call issue.context --input @issue-context.json --json
kordlet issue claim-next --project PROJECT_ID --json
kordlet review submit --input @submission.json --idempotency-key review-001 --json
kordlet mcp --profile PROJECT_ID
```

Use the same `@file.json` invocation in PowerShell. Pass `--input -` to read JSON from stdin. Ordinary CLI output is formatted JSON. `--json` also formats errors on stdout. Exit code 1 indicates a rejected request or invalid command. Exit code 3 indicates a retryable service or credential connection failure. The client times out requests after eight seconds. Retries of a mutation should reuse the same idempotency key and complete input.

MCP uses the TypeScript SDK over stdio. The [operation inventory](api-reference.md) lists tool names and allowed roles. Result envelopes contain `result` on success or `error` with MCP `isError` on failure. SDK clients can submit an idempotency key under request `_meta["kordlet.dev/idempotencyKey"]`. Tool inputs are strict JSON objects.

### Agent setup

From a project root, run `kordlet init KOR` to create a project and marker if needed. Run one of these commands to install project-scoped skills and a protected agent profile.

```sh
kordlet bootstrap --tool codex --scope project
kordlet bootstrap --tool claude --scope project
kordlet bootstrap --tool generic --scope project
```

Codex uses `.agents/skills` plus a managed block in `.codex/config.toml`. Claude Code uses `.claude/skills` plus a managed entry in `.mcp.json`. Enable project MCP configuration when the client prompts. Generic setup installs the skill files and prints the command and argument array. The installed command references a profile. Secret material stays in the local data directory.

Run `--dry-run` to inspect planned file changes or `--remove` to remove unchanged managed entries for the selected tool. Removal preserves the profile for other installations. Revoke it explicitly in Agents when it is obsolete. If interrupted, inspect the journal under `.kordlet`, restore the before values or finish the after values, then remove the journal and retry. Bootstrap rejects managed files edited after installation.

Agents should resolve the project explicitly, read context, claim Ready work, report meaningful progress, and submit evidence using the current revision and generation. The five bundled skills cover planning, work, review, handoff, and triage. Scope errors are enforced by the service even when a client supplies a different project ID.
