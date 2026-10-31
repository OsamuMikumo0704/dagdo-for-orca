# Orca workspaces

`dagdo` below is the launcher prefix from `SKILL.md`. Orca is a separate desktop application that manages Git worktrees. A dagdo task can link to one Orca workspace. dagdo never deletes a workspace and never starts an agent in one.

Except for `workspace task` and `workspace done`, these commands use the selected dagdo project, so they need `--project <ID>` when several projects exist. Add `--json` to all of them.

## Inside a linked workspace

Use the absolute launcher even when working in another repository.

| Command | Behavior |
| --- | --- |
| `dagdo workspace task` | Find the task linked to the current workspace, in any project. |
| `dagdo workspace done` | Complete that task after the requested work is finished. It respects prerequisites and is safe to repeat. |

Both accept `--workspace <identity-or-full-id>` or `--cwd <path>`, and optional `--project <ID>`. A saved workspace identity works while Orca is stopped; finding it from a directory needs Orca running. Missing or ambiguous matches fail without changes.

The JSON result has `project`, `task`, `state`, `workspace`, `changed` and `unblocked`. Completing a task keeps the workspace link. Orca's own status and archival are managed separately.

## Create a workspace

Create one only when the user asks. It makes a real Git worktree.

1. Find the Orca project: `dagdo workspace projects`. The result is `{"projects": [...]}`. Use an entry's `id` as the setup ID. Its `baseRef` is the default base branch.
2. Optionally search branches: `dagdo workspace refs --orca-project <setup-id> --query <text>`.
3. Create it:

```text
dagdo workspace create --task <id> --orca-project <setup-id> [--name <text>] [--base <ref>] [--branch <name>] [--hooks inherit|run|skip] [--open]
```

- Only a task in state `ready` can get a workspace, and each task has one.
- `--name` defaults to the task title. `--hooks` defaults to `inherit`.
- `--open` focuses the workspace in Orca, as the browser does. Leave it out to avoid switching the user's Orca window.
- Success moves the task to `in_progress` and returns `{"task", "opened"}`.
- `openError` means the workspace exists but did not open. Do not create it again.

## Inspect and open

`dagdo workspace status --task <id>` returns `status`, `task`, and `worktree` when available:

| Status | Meaning |
| --- | --- |
| `none` | The task has no workspace. |
| `pending` | Creation is reserved or uncertain. See below. |
| `available` | The workspace exists. `dagdo workspace open --task <id>` opens it in Orca. |
| `archived`, `missing` | The workspace is gone from active use. Unlinking is allowed. |
| `unavailable` | Orca could not be reached. Run `dagdo workspace start`, then check again. |

## Recover a pending creation

While creation is pending, the task and its project cannot be deleted and the task's status cannot change (error `creation_pending`). Other tasks stay editable. Never start a new creation for an uncertain operation.

1. Run `dagdo workspace reconcile --task <id>`. It links the workspace if Orca has a unique match.
2. On `recovery_required`, find the workspace with the user, then run `dagdo workspace reconcile --task <id> --workspace <selector>`. The selector is `identity:<key>` or `id:<full-id>`.
3. Run `dagdo workspace reconcile --task <id> --reset` only after confirming with the user that the original operation stopped and created nothing. Resetting an unknown operation can create duplicates.

`creation_busy` means creation may still be running, possibly in the browser's server. Wait 90 seconds and try again.

## Unlink

`dagdo workspace unlink --task <id>` works only for `missing` or `archived` workspaces (otherwise `workspace_active`). It returns the task to Ready and reopens it if it was completed. Confirm with the user first. The Orca workspace itself is not deleted.

## Errors

| Error | What to do |
| --- | --- |
| `orca_unavailable`, `runtime_not_running` | Run `dagdo workspace start`, or ask the user to open Orca. |
| `invalid_project` | Use an `id` from `dagdo workspace projects`. |
| `task_not_ready` | Only Ready tasks can create a workspace. |
| `workspace_exists`, `workspace_linked` | The task or workspace already has a link. |
| `workspace_unavailable` | Check `workspace status` first. |
| `orca_uncertain` | The result is unknown. Follow the recovery steps above and do not retry creation. |
| `no_pending_creation` | There is nothing to reconcile. |
