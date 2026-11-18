# Public operation reference

Generated from the canonical registry.

| Operation | REST | CLI | MCP | Role |
|---|---|---|---|---|
| `project.create` | `POST /api/v1/projects` | `kordlet project create` | `project_create` | owner |
| `project.list` | `GET /api/v1/projects` | `kordlet project list` | `project_list` | any |
| `project.get` | `GET /api/v1/projects/:projectId` | `kordlet project get` | `project_get` | any |
| `project.update` | `PATCH /api/v1/projects/:projectId` | `kordlet project update` | `project_update` | owner |
| `issue.create` | `POST /api/v1/projects/:projectId/issues` | `kordlet issue create` | `issue_create` | any |
| `issue.list` | `GET /api/v1/issues` | `kordlet issue list` | `issue_list` | any |
| `issue.get` | `GET /api/v1/issues/:issueId` | `kordlet issue get` | `issue_get` | any |
| `issue.update` | `PATCH /api/v1/issues/:issueId` | `kordlet issue update` | `issue_update` | any |
| `issue.transition` | `POST /api/v1/issues/:issueId/transitions` | `kordlet issue transition` | `issue_transition` | owner |
| `issue.complete` | `POST /api/v1/issues/:issueId/completion` | `kordlet issue complete` | `issue_complete` | reviewer |
| `issue.archive` | `POST /api/v1/issues/:issueId/archive` | `kordlet issue archive` | `issue_archive` | owner |
| `dependency.add` | `POST /api/v1/issues/:issueId/dependencies` | `kordlet dependency add` | `dependency_add` | owner |
| `dependency.remove` | `DELETE /api/v1/issues/:issueId/dependencies/:requiresId` | `kordlet dependency remove` | `dependency_remove` | owner |
| `issue.claim` | `POST /api/v1/issues/:issueId/claims` | `kordlet issue claim` | `issue_claim` | any |
| `issue.claimNext` | `POST /api/v1/projects/:projectId/claims/next` | `kordlet issue claim-next` | `issue_claim_next` | any |
| `claim.heartbeat` | `POST /api/v1/issues/:issueId/claim/activity` | `kordlet claim heartbeat` | `claim_heartbeat` | any |
| `claim.release` | `POST /api/v1/issues/:issueId/claim/release` | `kordlet claim release` | `claim_release` | any |
| `claim.reassign` | `POST /api/v1/issues/:issueId/claim/reassignment` | `kordlet claim reassign` | `claim_reassign` | owner |
| `comment.add` | `POST /api/v1/issues/:issueId/comments` | `kordlet comment add` | `comment_add` | any |
| `comment.list` | `GET /api/v1/issues/:issueId/comments` | `kordlet comment list` | `comment_list` | any |
| `review.submit` | `POST /api/v1/issues/:issueId/reviews` | `kordlet review submit` | `review_submit` | any |
| `review.decide` | `POST /api/v1/reviews/:reviewId/decisions` | `kordlet review decide` | `review_decide` | reviewer |
| `review.list` | `GET /api/v1/reviews` | `kordlet review list` | `review_list` | any |
| `issue.context` | `GET /api/v1/issues/:issueId/context` | `kordlet issue context` | `issue_context` | any |
| `event.list` | `GET /api/v1/events` | `kordlet event list` | `event_list` | any |
| `credential.create` | `POST /api/v1/projects/:projectId/credentials` | `kordlet credential create` | `credential_create` | owner |
| `credential.list` | `GET /api/v1/projects/:projectId/credentials` | `kordlet credential list` | `credential_list` | owner |
| `credential.revoke` | `DELETE /api/v1/projects/:projectId/credentials/:credentialId` | `kordlet credential revoke` | `credential_revoke` | owner |
| `project.export` | `GET /api/v1/projects/:projectId/export` | `kordlet project export` | `project_export` | owner |
| `project.import` | `POST /api/v1/imports` | `kordlet project import` | `project_import` | owner |
| `workspace.instructions` | `GET /api/v1/instructions` | `kordlet workspace instructions` | `workspace_instructions` | any |
