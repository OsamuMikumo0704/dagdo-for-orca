# Repository guide

## Orca workspace integration

`src/orca.ts` owns the CLI subprocess adapter, local project/ref discovery,
workspace creation reservation/reconciliation, stable identity binding,
opening/unlinking, and every `workspace` CLI subcommand. The HTTP server exposes
`GET /api/orca/projects`, `GET /api/orca/refs`, `POST /api/orca/start`, and the
project/task-scoped `/workspace` route (GET/POST/DELETE), with `/open` and
`/reconcile` POST actions. New side effects require same-origin browser requests.

`web/src/WorkspaceControls.tsx` provides the creation form, shown as a step inside
the task dialog, and linked workspace controls in task details. The actionable
list provides direct creation entry. Successful creation closes the dialog.
Task `orcaWorkspace` and `orcaCreation` fields are optional and validated on load
and save. Creation reserves under the graph lock, releases it during Orca work,
then saves the binding and progress together under the lock. Storage protects
reserved tasks against deletion/status changes through either CLI or HTTP.
The process-local reservation guard also prevents recovery while creation is
actively running. The CLI and server are separate processes, so recovery also
refuses a reservation younger than Orca's timeout plus 30 seconds unless it is
already marked uncertain. After that, for example following a server restart,
pending requests can be reconciled.
An injected adapter supplies deterministic tests in `tests/orca.test.ts` and the
isolated browser smoke script. Production always uses Orca CLI subprocesses.

dagdo is a local task manager with two interfaces: a browser graph editor and a
command-line interface. Both use the same JSON data file. The backend runs on
Bun; the browser uses React, TypeScript, React Flow and Tailwind CSS.

For installation and commands, start with [README](../README.md). For backup,
restore and Windows operations, see [Windows local operations](windows-local.md).

## Directory map

```text
app/                         Git repository; application code only
├── .github/workflows/
│   └── ci.yml               Automated validation; no package publication
├── docs/
│   ├── architecture.md      This guide
│   └── windows-local.md     Windows operation and recovery instructions
├── scripts/                 PowerShell launchers and backup implementation
├── skills/dagdo/
│   ├── SKILL.md             Agent-facing command reference
│   └── references/          Orca workspace procedures, loaded on demand
├── src/                     Bun backend and CLI
│   ├── commands/            One module per CLI command
│   ├── graph/               Graph algorithms, mutations and text rendering
│   └── server/              Local HTTP API and live update stream
├── tests/                   Bun tests, using isolated task data
├── web/                     Browser application and separate dependency set
│   ├── src/
│   │   ├── components/      Theme provider and reusable UI controls
│   │   └── lib/             CSS class helper
│   ├── package.json         Frontend dependencies and build commands
│   ├── bun.lock             Frontend dependency lockfile
│   ├── index.html           Browser entry document
│   ├── tsconfig.json        Frontend TypeScript configuration
│   └── vite.config.ts       Produces dist/web/index.html
├── AGENTS.md                Repository editing and data-safety rules
├── LICENSE                  MIT license and original copyright notice
├── README.md                Setup, features and command reference
├── package.json             Backend dependencies and project commands
├── bun.lock                 Backend dependency lockfile
├── tsconfig.json            Backend and test TypeScript configuration
└── .gitignore               Excludes dependencies and generated output
```

`node_modules/`, `web/node_modules/` and `dist/` are generated directories. Do not
edit them. `bun install --frozen-lockfile` installs backend dependencies;
`bun run build:web` installs frontend dependencies from its lockfile and builds
the browser bundle. `bun run build` is an alias for that UI build. The local
backend runs directly from `src/`; there is no binary or npm packaging step.

The normal Windows layout keeps mutable files outside this repository:

```text
dagdo/
├── app/                     This repository
├── data/
│   └── data.json            Real tasks, dependencies and projects
├── backups/                 Up to 30 normal backup generations
└── local/
    ├── logs/                Server standard output and error logs
    ├── runtime/server.json  Process identity used for safe stopping
    └── test-data/           Isolated directories created by check.ps1
```

Backup generations contain `data.json` and `metadata.json` with the source
revision, working-tree state, Bun version and data location. A restore also
preserves the previous data bytes in a `before-restore-*` directory; those
rescue copies are not automatically removed.

## Backend files

`src/environment.ts` resolves Git worktree identity and default paths for both Bun and PowerShell (via `scripts/environment.ts`). Additional worktrees use `.dagdo-dev/` within their own directory for data, backups and runtime files. `src/development-sample.ts` supplies the initial fictional graph, saved once under the storage lock. Main worktree defaults remain unchanged. Development servers select free ports from 3738 and record their URL in their own runtime state.

| File or directory | Responsibility |
| --- | --- |
| `src/cli.ts` | Parses the command name, dispatches to command modules, applies local-mode restrictions and reports failures, as `{error, message}` with `--json`. |
| `src/cli-error.ts` | `CliError`, an expected failure with a stable code. Commands throw it instead of exiting, so the data lock is always released. |
| `src/commands/add.ts`, `edit.ts`, `done.ts`, `reopen.ts`, `remove.ts` | Create, modify, complete, reopen and remove tasks; parse flags and print CLI results. |
| `src/commands/link.ts`, `unlink.ts` | Manage task dependencies. |
| `src/commands/list.ts`, `next.ts`, `show.ts`, `status.ts` | Read and summarize tasks and blockers. |
| `src/commands/projects.ts` | List, create, rename and delete projects. |
| `src/commands/history.ts` | `undo` and `redo`, through the running server's history routes. |
| `src/commands/shared.ts` | JSON output, `--note-file` reading and mutation error messages. |
| `src/commands/graph.ts`, `view.ts` | Export ASCII, Mermaid, DOT, PNG or SVG; open an exported graph in a browser. |
| `src/commands/ui.ts`, `help.ts` | Start the HTTP server and display CLI help. |
| `src/types.ts` | Persistent task and edge types, plus internal graph and layout types. |
| `src/storage.ts` | Resolve the data path, validate/load JSON, coordinate writers with a lock and atomically save data. |
| `src/graph/dag.ts` | Build adjacency maps, count unfinished blockers and detect cycles. |
| `src/task-state.ts` | Shared progress values, labels, validation and effective state derivation used by CLI and browser, plus `describeTask`, the task shape in CLI JSON. |
| `src/graph/topo.ts` | Find ready tasks and compute topological ordering and levels. |
| `src/graph/mutations.ts` | Pure task, dependency and project operations used by the HTTP API and CLI; also defines the shared note-length limit. |
| `src/graph/render.ts` | Compute CLI graph layouts and render ASCII, Mermaid and DOT text. |
| `src/server/server.ts` | Serve the UI, validate API input, perform mutations and broadcast graph updates. |
| `src/server/index.ts` | Re-export the server startup function and types. |
| `src/ids.ts`, `format.ts`, `open.ts` | Generate/resolve task IDs, format CLI output and open external files or URLs. |
| `src/git.ts`, `commands/sync.ts` | Compatibility code for Git-backed task history and remote synchronization. |
| `src/upgrade.ts`, `alias.ts` | Compatibility code for upstream npm update checks and shell alias suggestions. |

The compatibility modules remain because the source still imports them and tests
exercise them. The Windows launchers set `DAGDO_LOCAL_MODE=1`, which disables
remote sync, npm upgrade checks, the upgrade command and alias prompts. This fork
is an open-source local application with no npm publishing automation. Calling
`src/cli.ts` directly without local mode can enable the legacy behaviors.

## Browser files

| File | Responsibility |
| --- | --- |
| `web/src/main.tsx` | Mount React and install the theme provider. |
| `web/src/App.tsx` | Coordinate graph state, API actions, selection, keyboard shortcuts, projects, layouts and the canvas. |
| `web/src/TaskNode.tsx` | Display a task node, its handles, state and inline editing. |
| `web/src/DraftNode.tsx` | Edit a new task before creating it. |
| `web/src/TaskPanel.tsx` | Edit title, progress, notes and task actions in a centered modal, with a labeled creation timestamp. |
| `web/src/FocusPanel.tsx` | Show actionable tasks; single-click centers a task on the map and double-click opens task details. |
| `web/src/OrcaIcon.tsx` | Shared Orca workspace indicator using the existing Lucide icon set. |
| `web/src/layout.ts` | Arrange connected components using Dagre, in tree or mind-map orientation, and arrange task nodes. |
| `web/src/api.ts` | Typed HTTP mutation requests and API error mapping. |
| `web/src/types.ts` | Browser copies of the data types and UI-specific types. |
| `web/src/globals.css` | Global styles, colors and theme tokens. |
| `web/src/components/theme-provider.tsx` | Light, dark and system theme state. |
| `web/src/components/ui/*.tsx` | Shared button, input, textarea, badge, label and checkbox controls. |
| `web/src/lib/utils.ts` | Merge conditional Tailwind classes with `cn()`. |

The backend and browser have separate type definitions. Keep both in sync when
changing the data format or API. Theme, layout preference and some panel settings
use browser `localStorage`. Dragged node positions are held in browser component
state; they are not fields in `data.json`.

## Data and request flow

`src/server/history.ts` holds up to 100 map operations per project in server
memory. All tabs share the cursor and positions, separately for each layout.
HTTP mutations and observed CLI/file changes enter the same history; identical
updates are ignored. The file watcher may combine rapid external saves.
`GET /api/projects/:id/history` and SSE `history` return the graph, positions,
revision and availability. Project-scoped `POST /history/undo`,
`POST /history/redo`, `PATCH /positions`, and `DELETE /selection` require
same-origin requests and a current revision. Restoration runs under the graph
lock. Task creation optionally accepts `placement: {mode, x, y}` to combine
creation and placement in one step. Workspace metadata remains live during
restoration and pending creation protections still apply. History resets on
restart and is not written to data.json or included in backups.

`ProjectStore` has `version: 2` and `projects`. Each project contains its ID, name and an independent task/edge graph. Graph algorithms use the internal version-1 GraphData shape. Legacy data migrates to Default on read and is persisted on the next write; review becomes in_progress. All writers hold the shared graph lock before reading. Backup and restore include every project. Browser selection is session-local.

The CLI flow is `scripts/dagdo.ts` or `scripts/dagdo.ps1` → `src/cli.ts` → a
command module → `src/storage.ts`. `add`, `edit`, `reopen`, `link` and `projects`
use the pure mutations; `done`, `rm` and `unlink` still implement their own logic.
The browser flow is `App.tsx` → `api.ts` → `server.ts` →
`graph/mutations.ts` → `storage.ts`. A change to task rules must account for both
paths; updating a pure mutation function alone does not update every CLI command.

A running server records its URL and process ID in `.server.json` beside
`data.json`, so `undo` and `redo` reach the server that owns this data directory.
History itself stays in server memory. The file is removed on a clean stop; the
CLI ignores a leftover whose process has exited.

All writers must acquire `withGraphLock` **before loading the graph**, then load,
modify and save inside the lock. The lock is reentrant within the same async
context. `saveGraph` takes a lock itself, but that alone cannot protect a graph
loaded earlier from concurrent updates. Saving validates data, writes a temporary
file, flushes it and renames it into place. Invalid existing JSON causes an error
instead of being replaced with an empty graph.

The browser first fetches `/api/projects/:id/graph`, then listens to `/api/projects/:id/events` using
Server-Sent Events. API writes broadcast the updated graph immediately. The
server also checks the JSON file modification time every 500 ms, so CLI changes
reach connected browsers. It serves the built UI from `dist/web/index.html` and
listens on `127.0.0.1`; the Windows launcher uses port 3737.

| HTTP route | Purpose |
| --- | --- |
| `GET /`, `GET /index.html` | Built browser application. |
| `GET /api/projects/:id/graph` | Complete current graph. |
| `GET /api/projects/:id/events` | Stream of full-graph `update` events. |
| `POST /api/shutdown` | Same-origin browser shutdown; drain pending requests, send SSE `shutdown`, close the server and end the UI command. |
| `POST /api/projects/:id/tasks` | Create a task, in the specified project. |
| `PATCH /api/projects/:id/tasks/:id`, `DELETE /api/projects/:id/tasks/:id` | Update or remove a task. |
| `POST /api/projects/:id/edges`, `DELETE /api/projects/:id/edges` | Add or remove a dependency, with `from` and `to` in the JSON body. |
| `POST /api/projects` | List/create projects. |
| `PATCH /api/projects/:id`, `DELETE /api/projects/:id` | Rename or delete a project. |

## Operation scripts and checks

| Script | Purpose |
| --- | --- |
| `scripts/common.ps1` | Resolve paths, launch Bun with scoped environment variables and identify the owned server process. |
| `scripts/start.ps1` | Back up, start the server in the background, record its identity and optionally open the browser. |
| `scripts/stop.ps1` | Stop only the server matching the recorded process identity. |
| `scripts/dagdo.ps1` | Run CLI commands against the local data directory from any working directory. Supports Windows PowerShell 5.1 and PowerShell 7. |
| `scripts/dagdo.ts` | Same as `dagdo.ps1` through Bun alone, for agents and other shells. |
| `scripts/install-skill.ts` | Link `skills/dagdo` into the user's agent skill folders from the main worktree. |
| `scripts/backup.ps1`, `restore.ps1` | Launch backup and guarded restore operations. |
| `scripts/local.ts` | Implement initialization, locked backup, backup retention and restore. |
| `scripts/check.ps1` | Run Bun tests, backend/frontend type checks and the UI build with isolated task data. |
| `scripts/install-shortcuts.ps1` | Create optional Windows start shortcuts and remove matching legacy stop shortcuts. |

The PowerShell launchers support the Windows-provided 5.1 runtime as well as 7.
`common.ps1` centralizes Windows native argument quoting and child-only
environment variables using .NET Framework-compatible APIs. The start script
briefly sets and restores process-local variables for its hidden background
server; no user or machine environment settings are changed.
`tests/powershell.test.ts` checks argument fidelity and environment isolation;
`tests/worktree.test.ts` checks launch/stop/backup/restore in Unicode paths with
spaces. CI runs the full check script with each PowerShell version.

`tests/dag.test.ts` and `topo.test.ts` cover graph algorithms;
`mutations.test.ts` covers pure data operations; `commands.test.ts` covers CLI
behavior; `agent-cli.test.ts` drives every agent command through `scripts/dagdo.ts`;
`skill.test.ts` keeps the skill and help in step with the CLI and covers skill
installation; `server.test.ts` covers HTTP, streaming and project behavior;
`storage.test.ts` covers persistence; `view.test.ts` covers exported HTML; and
`git.test.ts` covers the retained Git integration. `local-workflow.test.ts`
exercises concurrent CLI/HTTP writers, backups, recovery and local restrictions.
Tests must use temporary `DAGDO_DATA_DIR` paths, never the real task directory.

## Where to make common changes

| Desired change | Start here, then check |
| --- | --- |
| Change colors, spacing or typography | `web/src/globals.css`, the relevant component and shared UI controls. |
| Change graph spacing or orientation | `web/src/layout.ts`; also inspect node dimensions in `App.tsx` and `TaskNode.tsx`. CLI export layout is separate in `src/graph/render.ts`. |
| Change shortcuts or task-creation gestures | `web/src/App.tsx` and `DraftNode.tsx`. |
| Add a task field | Both `types.ts` files, storage validation, CLI commands, HTTP input handling, pure mutations, browser API types and editing components. Decide how old files get a default. |
| Change readiness or cycle rules | `src/graph/dag.ts`, `topo.ts`, mutation/CLI consumers and browser state derivation in `web/src/layout.ts`. |
| Add or modify a CLI flag | The command module and its tests; update `src/commands/help.ts`, `README.md` and `skills/dagdo/SKILL.md` together. |
| Add a browser action | Also add the matching CLI command and `--json` result, so agents keep parity. List it in the `SKILL.md` command table. |
| Add an API operation | `src/server/server.ts`, `src/graph/mutations.ts`, `web/src/api.ts`, its UI caller and server/mutation tests. |
| Change project behavior | `App.tsx`, project selection in `App.tsx`, project mutations in `src/graph/mutations.ts` and the server handlers. |
| Change backups, launch paths or ports | `scripts/common.ps1`, `start.ps1`, `local.ts` and the local workflow tests; update the Windows operations guide. |

Before editing source, stop the UI and agent writes, then run
`scripts/backup.ps1`. After editing, run
`scripts/check.ps1`, restart with `scripts/start.ps1`, and refresh the browser.
Never patch the generated bundle or the real `data/data.json` by hand.

Backlog uses the optional progress value `backlog` in the version-2 project store. Existing data needs no migration. The sidebar lists Backlog separately; map and CLI graph exports omit it. Task PATCH accepts `clearDependencies` for confirmed removal when moving to Backlog and optional `placement: {mode, x, y}` when moving an unfinished Backlog task to Ready. Both actions are atomic history entries. To roll back after saving Backlog tasks, restore compatible source and a pre-change data backup together. Run `bun run scripts/backlog-browser-check.ts` for isolated browser coverage.

## Portable operations

`scripts/manage.ts` implements foreground startup (with backup), backup and guarded restore for every OS. `scripts/check.ts` runs tests, types and build with temporary data. `src/environment.ts` supports source ZIPs without Git metadata. See [operations](operations.md).
