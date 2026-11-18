# Local data and recovery

| Platform | Default data directory |
|---|---|
| Linux | `${XDG_DATA_HOME:-~/.local/share}/kordlet` |
| macOS | `~/Library/Application Support/kordlet` |
| Windows | `%LOCALAPPDATA%\kordlet` |

Set `KORDLET_DATA_DIR` in the trusted launch environment to override it. Use the same override in the application and adapters. Store the database on a local filesystem. SQLite's WAL and exclusive ownership file rely on local filesystem locking. One instance holds an exclusive SQLite transaction in a separate ownership file before the primary database opens. An OS process exit releases the transaction. Stale metadata does not authorize killing any process.

The active database is `workspace.sqlite`. A one-time URL opens a cookie-based browser session. The directory also holds temporary runtime metadata, an owner token, and optional agent profiles. Treat tokens and backups as sensitive. Unix creates these files with owner-only permissions. Windows relies on the user profile directory's inherited ACLs. An override should have the equivalent per-user access. Credentials provide application-level attribution within the same OS account.

## Backup and restore

1. Quit the owning Electron app or stop the headless service. Wait for shutdown.
2. Run `kordlet backup /absolute/path/kordlet-backup.sqlite`.
3. To restore, take a separate backup of the current workspace first. Then run `kordlet restore /absolute/path/kordlet-backup.sqlite` while the service is still stopped.
4. Restart Kordlet and verify projects, active claims, and recent events.

Maintenance takes the same ownership lock as startup. Backup uses SQLite's backup API. Restore checks integrity and schema version, copies into a sibling temporary database, checkpoints the old database, then replaces it. If interrupted before replacement, the old database remains. Remove a leftover temporary file only after confirming no restore is active. Owner tokens and profiles are separate from the database. Database snapshots include hashed credentials and idempotency state. Moving a snapshot alone to a new machine does not transfer the corresponding secrets.

Portable JSON via `project.export` contains one project, with up to 1,000 issues, 10,000 each for dependency/comment/review records, and less than 3.5 MB of encoded JSON. `project.import` always creates a new project using a new unique prefix. Remapping is deterministic within that imported project. Claims, repository bindings, and credentials are omitted. In-progress or in-review issues move to Backlog. Historical authors and evidence remain historical, and user-authored text can contain paths or secrets.

Schema version 1 is the initial persistent format. Startup refuses a newer schema before making database changes. Keep a backup before replacing the application with a newer version.
