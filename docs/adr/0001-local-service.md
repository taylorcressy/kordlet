# Local service and public contracts

Kordlet uses one loopback service for each canonical data directory. The web UI and Electron renderer use the same fetch client as the CLI and MCP server. The registry uses a common subset of JSON Schema and supplies runtime validation and adapter metadata. Electron main delegates service work to a utility process.

SQLite WAL keeps claims, revisions, audit events and idempotent results in a single transactional store. Durable claims have monotonically increasing generations. Review decisions refer to immutable submissions, and changes to issue fields are gated during review.

Boardroom follows the reference with a graphite canvas, slate lanes, indigo selection and a cyan active-card outline. The navigation rail, search bar and split inspector retain left-aligned text. Inter provides the compact reading scale. On narrow screens the inspector overlays the board.

The architecture uses Electron's isolated utility process, the SQLite WAL model, and a schema subset validated with Ajv, the MCP SDK, and a separate OpenAPI validator. [Electron utility processes](https://www.electronjs.org/docs/latest/api/utility-process) · [SQLite WAL](https://www.sqlite.org/wal.html) · [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) · [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html)

## Workflow comparisons

Backlog.md's developer onboarding and Beads' ready-work coordination informed the project marker, scoped agent setup, and single transactional claim. Kanboard's SQLite deployment informed the single service and offline maintenance workflow. Vibe Kanban and Plane informed the emphasis on review and readable issue grouping. Kordlet's interface and domain code are original. [Backlog.md](https://github.com/MrLesk/Backlog.md) · [Beads](https://github.com/gastownhall/beads) · [Kanboard](https://docs.kanboard.org/v1/admin/sqlite/) · [Vibe Kanban](https://github.com/BloopAI/vibe-kanban) · [Plane](https://github.com/makeplane/plane)
