# Windows local operations

## Orca integration

Orca must have a ready local Git project setup. Ready tasks can create one
independent workspace through Orca CLI and then become In Progress. Start agents
manually in Orca. `workspace task|done` on the absolute DAGDO launcher resolves
the caller's Orca workspace, even though the launcher executes Bun from the app
directory. `--workspace <identity-or-id>` supports exact offline lookup;
`--cwd <path>` explicitly selects the caller location. Search defaults to every
DAGDO project in the launcher's data directory. A process-local `DAGDO_DATA_DIR`
override continues to select an isolated store. Agents use the other `workspace`
subcommands for everything the task dialog offers; see the agent skill.

Set `DAGDO_ORCA_COMMAND` for this process to override the Orca executable path.
No shell arguments are allowed in that setting. The integration targets local
Orca and ignores inherited remote environment/pairing selectors.

Workspace metadata and pending creation reservations are optional task fields in
the existing version-2 store and are included in normal backups. Restore both
source and data together when rolling back. Pending creation blocks task/project
deletion and task status changes. Unknown results require reconciliation from
task details, rather than a fresh automatic creation attempt. The reset action
requires confirming the original operation is stopped and did not create a
workspace. Missing/archived bindings can be explicitly removed while reopening
the task; the Orca workspace itself is preserved. Recovery reports `creation_busy`
for up to 90 seconds after a reservation starts, because the creating process may
be the server or a CLI.

Run `bun run scripts/orca-browser-check.ts` for the isolated Orca UI smoke check.
It injects a fake Orca adapter and never creates a real Orca workspace.
Run `bun run scripts/connection-browser-check.ts` to check the server-down dialog
and automatic reconnection against a temporary server and data directory.

## Installation layout

Only `app` is tracked by Git. In the main worktree, task data, backups, and runtime files are siblings of the repository (additional worktrees use their own `.dagdo-dev/`, described below):

```text
C:\path\to\dagdo\
  app\
  data\data.json
  backups\
  local\logs\
  local\runtime\
  local\test-data\
```

Paths are derived from the repository location. Use Windows PowerShell 5.1 (included with Windows) or PowerShell 7, plus Bun 1.4.4 or newer; PowerShell 7 is optional. `scripts/common.ps1` resolves Bun on PATH, then falls back to `$env:USERPROFILE\.bun\bin\bun.exe`. For foreground startup and other platforms, see [cross-platform operations](operations.md).

From `app`, install dependencies with `bun install --frozen-lockfile`, then run `.\scripts\check.ps1` to verify and build the interface.

## Daily commands

Use the **Undo** and **Redo** arrows at the map's upper right, or Ctrl+Z and
Ctrl+Y / Ctrl+Shift+Z. Task edits, dependencies and dragged positions share one
history per project across all tabs, including observed CLI/agent changes.
Multiple selected tasks can be moved or deleted as one operation. A new edit
after Undo clears Redo. Input fields retain normal text undo behavior.
History retains 100 operations while the server runs, including across page
reloads; shutdown or restart clears it. Positions are shared per layout and are
not written to task data. Project management and external Orca workspace
operations are outside map undo. Workspace bindings remain current, and pending
workspace creation may prevent restoring a task state. Agents reach the same
history with `undo` and `redo` while the server runs.

| Script | Behavior |
| --- | --- |
| `scripts/start.ps1 [-NoOpen]` | Back up data and start the UI in the background on port 3737. `-NoOpen` skips opening a browser. A port conflict is an error. |
| `scripts/stop.ps1` | Stop only the server whose PID, start time, and executable match the saved runtime state. |
| `scripts/dagdo.ps1 <command> [options]` | Run the CLI against local data, even when the UI is stopped. Supports Windows PowerShell 5.1 and PowerShell 7. |
| `bun run scripts/dagdo.ts <command> [options]` | Same as `dagdo.ps1`, through Bun alone. Agents use this from Windows PowerShell 5.1, Git Bash or any other shell. |
| `bun run scripts/install-skill.ts` | Link the agent skill into `~/.agents/skills/dagdo` and `~/.claude/skills/dagdo`. Run once from the main worktree. Existing correct links are kept, and anything else at those paths is left in place with an error. |
| `scripts/backup.ps1` | Save graph data and metadata; retain the most recent 30 completed generations. |
| `scripts/restore.ps1 -Generation <absolute-path> -WritesStopped` | Restore a backup after the UI and all agent writes have stopped. |
| `scripts/check.ps1` | Run tests, TypeScript checks, and the UI build using an isolated data directory. |
| `scripts/install-shortcuts.ps1` | Create start shortcuts in the application parent directory and on the desktop; remove legacy stop shortcuts only when they point to this application's stop script. Existing start shortcuts are preserved. |

For example, from the repository directory:

```powershell
.\scripts\start.ps1
.\scripts\dagdo.ps1 next
.\scripts\dagdo.ps1 add 'Design the settings page' --progress ready
.\scripts\stop.ps1
```

From another directory, call the launcher by its absolute path:

```powershell
& 'C:\path\to\dagdo\app\scripts\dagdo.ps1' next
```

If the default execution policy blocks scripts, use a process-only override:
`powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1`.
The same prefix works for the other scripts. This leaves the user and machine
execution policies unchanged. Launchers use compatible Windows argument quoting
and child environment variables on both PowerShell versions; Unicode paths,
spaces, quotes and trailing backslashes are preserved. The start script restores
its caller's process environment immediately after launching the hidden server.

Click **Shut down** in the browser header and confirm to stop the server. Other connected tabs also show the ended screen. Close the tabs manually and use the start shortcut to restart. Closing the browser alone does not stop the server. `scripts/stop.ps1` remains available for maintenance. After browser shutdown the old runtime record is harmless: start validates its process identity and replaces it. Server output is written to timestamped files in `local/logs`. The saved process identity is in `local/runtime/server.json`.

## Backups and restore

`backup.ps1` takes the graph lock before reading. Each completed backup contains `data.json` and `metadata.json`, recording its time, source revision, whether source changes were uncommitted, Bun version, and data directory. Startup also creates a backup before launching the server.

To restore:

1. Stop the UI with `scripts/stop.ps1` and stop all assistants or terminals that are writing tasks.
2. Choose a completed generation directly inside `backups`.
3. Run the restore script with its absolute path:

```powershell
.\scripts\restore.ps1 -Generation 'C:\path\to\dagdo\backups\<generation>' -WritesStopped
.\scripts\start.ps1
```

`-WritesStopped` acknowledges that all other writers have stopped. Restore validates the backup and preserves the current raw data in a `before-restore-*` directory, even if that data is damaged. These rescue copies are not automatically removed.

Backups on the same disk do not protect against disk failure. Copy backups to separate storage when needed.

## Environment and data safety

### Linked worktree development

Git's additional worktrees are detected automatically, independently of their folder names or branches. Each keeps `data/`, `backups/`, and `local/` beneath its own Git-ignored `.dagdo-dev/`. The first data access initializes fictional tasks with a dependency, completed task and tab under the graph lock. Existing data is preserved. No production tasks are copied.

The launchers and direct source execution (`bun run dev ...`) share this detection. Direct execution in additional worktrees also enables local mode. Failure to resolve Git metadata is an error. Main worktree launchers retain the sibling production directories, while direct execution in the main worktree retains its existing `~/.dagdo` fallback.

Process-level `DAGDO_DATA_DIR` and `DAGDO_BACKUP_DIR` overrides take precedence; custom data locations start empty. Never set these globally. Backup and restore scripts use the worktree's backup directory by default.

Development UIs search up to 200 ports starting at 3738 (or the explicit `--port`), while production remains strict on 3737. The actual URL is printed and recorded in that worktree's runtime state. Start/stop locks and process state are independent, so stopping one worktree does not stop another or production. After a build, use that worktree's `scripts/start.ps1` to start its UI. Directly launched servers are stopped with Ctrl+C.

In the main worktree, the local launchers default `DAGDO_DATA_DIR` to the sibling `data` directory and set `DAGDO_LOCAL_MODE=1` for child processes. They do not set user-wide environment variables.

Local mode disables npm update checks, `upgrade`, `sync`, and shell alias prompts. It also makes the UI port strict instead of automatically selecting another port. No cloud task sync or npm publication is configured for this fork.

All writers must acquire `withGraphLock` before loading, modifying, and saving the graph. Writes use an atomic replacement file. Concurrent edits to the same property use the last saved value. Never edit the real `data/data.json` directly.

A running server writes `.server.json` beside `data.json` so the CLI can reach its in-memory history. It holds no task data and is not part of backups.

Lock acquisition times out after 10 seconds. Only locks belonging to a dead process are reclaimed automatically. Missing or invalid owner information is not reclaimed. If a lock remains, first stop all processes that use the data, then inspect `.data.lock` and its owner information.

Invalid JSON raises an error instead of becoming an empty task list. Backup also fails on invalid data; restore a valid backup to recover.

## Modifying the application

Use this sequence: stop the UI and all agent writes, back up, make the changes, run `scripts/check.ps1`, then restart.

Tests and manual experiments must use temporary `DAGDO_DATA_DIR` paths. Set the override only for those processes; never set it globally. The check script creates a unique directory beneath `local/test-data` and the tests also use temporary directories.

When changing CLI commands or flags, update `src/commands/help.ts`, `README.md`, and `skills/dagdo/SKILL.md` together. For a schema change, plan how to restore both compatible source and data from backups.

See [Repository architecture](architecture.md) for source locations and data flow. [AGENTS.md](../AGENTS.md) contains the concise repository working rules.

Projects: run `scripts/dagdo.ps1 projects [--json]` to list IDs, and `projects add <name>`, `projects rename <ID> <name>` or `projects rm <ID> [--force]` to manage them. Task commands (including `graph` and `view`) accept `--project <ID>`; this is required when multiple projects exist. `--all` includes completed tasks within the selected project. Existing tasks migrate to Default, old Review progress becomes In Progress, and tab grouping is removed. Project deletion removes its tasks and dependencies; the last project cannot be deleted.

For rollback after migration, restore both the previous source revision and a pre-migration backup. Old source cannot read the version-2 project store.

Task categories have been removed. Legacy `tags` fields are discarded in memory
when reading version-1 or version-2 data, and removed from all projects on the next
normal locked save. Other task fields and workspace bindings are retained. To
recover removed fields, restore the previous source and a pre-change backup together.

Optional browser smoke checks: `bun run scripts/browser-check.ts` uses temporary data and a local headless Chromium. Set process-local `DAGDO_BROWSER_EXECUTABLE` to an installed compatible Chromium executable if the Playwright default is unavailable.

Run `bun run scripts/canvas-browser-check.ts` to check Alt-hover previews,
Alt-click creation, drag selection and Space-drag panning in both themes with
temporary data. CI runs `scripts/check.ps1` under both Windows PowerShell 5.1 and
PowerShell 7, including isolated launch, backup, stop and restore checks.

Backlog uses the optional progress value `backlog` in the version-2 project store. Existing data needs no migration. The sidebar lists Backlog separately; map and CLI graph exports omit it. Task PATCH accepts `clearDependencies` for confirmed removal when moving to Backlog and optional `placement: {mode, x, y}` when moving an unfinished Backlog task to Ready. Both actions are atomic history entries. To roll back after saving Backlog tasks, restore compatible source and a pre-change data backup together. Run `bun run scripts/backlog-browser-check.ts` for isolated browser coverage.
