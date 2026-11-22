# REST contract

All public domain operations are listed in the [generated reference](api-reference.md) and [OpenAPI 3.1.1 document](../generated/openapi.json). The HTTP API uses `/api/v1`. Send a scoped bearer credential for automation. The browser uses a SameSite, HttpOnly local session cookie. Cookie-authenticated mutations require the exact loopback Origin. Automation can send `Kordlet-Contract: 1` to require this release's wire contract.

Input objects reject unknown fields. Path parameters are strings and are bound separately from query or body fields. GET integer fields accept decimal digits, and booleans accept literal `true` or `false`. Repeated query parameters and collisions between path/body fields are rejected. The common schema subset uses JSON primitives, bounded arrays and objects, optional properties, enums, const and nullable unions. Fastify passes parsed input to Ajv without coercion or mutation. Canonical outputs are also validated before the transaction commits.

List calls return `items` and `cursor`. Pass a non-null cursor to continue with the same filters. Issue, project, comment and review lists are ordered by insertion. Claim-next uses Urgent, High, Medium, Low priority, then insertion order. Event cursor values are stable monotonic event sequences. Events are currently retained for the lifetime of the database. Browser streaming is an invalidation feed over the same event log, with replay after Last-Event-ID.

Mutations accept `Idempotency-Key` except credential creation. Keys are scoped to actor, project or workspace, and operation, and currently retained for the lifetime of the database. Explicitly reuse the original key and input after an uncertain response. A replayed claim result does not reestablish ownership. Credential issuance never records its plaintext response in the idempotency table.

Errors include `code`, `message`, `requestId`, `retryable`, and where applicable `currentRevision`. Fetch a fresh issue revision after an edit conflict, and a fresh context after a stale claim. Error `scope_denied` indicates a valid credential used outside its project.

Lifecycle and transport exceptions are GET `/health`, POST `/session/launch`, POST `/session`, GET `/stream`, and GET/HEAD static UI assets. Local CLI exceptions include launch, discovery, backup/restore, setup installation, and output formatting.

Project creation accepts the owner or the built-in workspace agent credential. Project-scoped agent and reviewer credentials cannot create projects.

Permanent project deletion is a local owner UI operation. The session route requires a same-origin browser session and rejects bearer credentials. It is omitted from the public REST, CLI, and MCP operation inventories.

Local workspace agents can pass a private UUID in `Kordlet-Agent-Session` using the built-in workspace agent bearer token. The server derives the actor ID from the UUID. Local workspace sessions and project-scoped agents can request changes on another actor’s pending submission. Agents can post `review_feedback` comments without a claim in projects they can access. Progress comments retain the active claim requirement, and approval retains the owner or reviewer requirement. The CLI accepts the same UUID via `KORDLET_AGENT_SESSION`.
