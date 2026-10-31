import pc from "picocolors";

const HELP = `
${pc.bold("dagdo")} — dependency-aware todo manager

${pc.bold("Usage:")} dagdo <command> [options]

Agents and other shells: bun run scripts/dagdo.ts <command> [options]
All platforms: bun run start | backup | check
Restore: bun run restore <generation> --writes-stopped (stop all writers first).
Windows .ps1 launchers support Windows PowerShell 5.1 and PowerShell 7.
Linked worktrees use isolated .dagdo-dev/data with initial sample tasks.
Development UI ports start at 3738. DAGDO_DATA_DIR overrides the data path.

${pc.bold("Commands:")}
  ${pc.cyan("projects")} [--json]             List projects
  ${pc.cyan("projects")} add <name>           Create a project
  ${pc.cyan("projects")} rename <ID> <name>   Rename a project
  ${pc.cyan("projects")} rm <ID> [--force]    Delete a project; --force is required if it has tasks

  ${pc.cyan("add")} <title> [options]      Add a task
      --progress <backlog|ready|in_progress>  Set progress (default: ready)
      --after <id>                   This task depends on <id>
      --before <id>                  <id> depends on this task
      --note <text>                  Set note (plain text, max 2000 chars)
      --note-file <path>             Read the note from a UTF-8 file

  ${pc.cyan("rm")} <id> [<id2> ...] [--force]   Remove tasks and their edges together
      --force                        Also remove tasks that others depend on

  ${pc.cyan("edit")} <id> [options]         Edit a task
      --title <new>                  Change title
      --progress <backlog|ready|in_progress>  Change progress
      --note <text>                  Set note (plain text, max 2000 chars)
      --note-file <path>             Read the note from a UTF-8 file
      --clear-note                   Clear the note
      --clear-dependencies           Remove all connections when moving to Backlog

  ${pc.cyan("show")} <id>                   Show task details and dependencies

  ${pc.cyan("list")} [options]              List tasks (alias: ls)
      --all                          Include done tasks
      --done                         Show only done tasks

  ${pc.cyan("done")} <id> [<id2> ...]       Mark task(s) as done (blocked tasks cannot be completed)

  ${pc.cyan("reopen")} <id> [<id2> ...]     Undo completion of task(s)

  ${pc.cyan("next")} [--limit <n>]          Show tasks ready to do (in-degree = 0)

  ${pc.cyan("link")} <id> --before <other>   <id> must be done before <other>
  ${pc.cyan("link")} <id> --after <other>    <id> must be done after <other>

  ${pc.cyan("unlink")} <id-a> <id-b>          Remove dependency between two tasks

  ${pc.cyan("undo")}                        Undo the latest map change (needs the UI server)
  ${pc.cyan("redo")}                        Redo the latest undone change (needs the UI server)

  ${pc.cyan("graph")} [options]             Visualize the task DAG
      --all                          Include done tasks
      --json                         Output tasks and edges
      --mermaid                      Output Mermaid syntax
      --png <file>                   Render to PNG/SVG (Mermaid, requires playwright)
      --dot                          Use Graphviz instead of Mermaid for --png

  ${pc.cyan("view")}                        Render full graph as SVG and open it in a browser

  ${pc.cyan("ui")} [options]                 Open an interactive web view (live-updates)
      --port <n>                     Preferred port (default 3737; strict in local mode)
      --no-open                      Don't auto-open the browser

  ${pc.cyan("status")}                      Overview of all tasks

  workspace task|done [options]  Find or complete the task linked to an Orca workspace
      --workspace <identity-or-id>   Exact saved workspace identity or full ID
      --cwd <path>                   Resolve Orca workspace from this directory
      --project <ID>                 Restrict search (otherwise all projects)
      Without --workspace/--cwd, uses the launcher's caller directory.

  workspace projects|start       List ready local Orca projects; start Orca

  workspace refs --orca-project <setup-id> [--query <text>]   Search branches

  workspace create --task <id> --orca-project <setup-id> [options]   Create and link a workspace
      --name <text>                  Workspace name (default: task title)
      --base <ref>                   Branch from this ref (default: project default)
      --branch <name>                Git branch name
      --hooks <inherit|run|skip>     Setup hooks (default: inherit)
      --open                         Open the workspace in Orca afterwards

  workspace status|open|unlink --task <id>   Inspect, open or unlink a linked workspace

  workspace reconcile --task <id> [options]  Resolve a pending workspace creation
      --workspace <selector>         Link this existing workspace
      --reset                        Clear it after confirming nothing was created

  ${pc.cyan("sync")} [options]              Sync global tasks with a git remote
      init <url>                     Configure sync with a git remote URL
      status                         Show sync status (ahead/behind/diverged)
      --accept-local                 Force-push local state (overwrites remote)
      --accept-remote                Force-pull remote state (overwrites local)

  ${pc.cyan("upgrade")}                     Check for updates and upgrade

  ${pc.cyan("help")}                        Show this help

Task, project, workspace, undo and redo commands accept --json. Results go to
stdout; failures exit 1 and print {"error","message"} to stderr.

Environment: DAGDO_DATA_DIR overrides the task directory.
DAGDO_LOCAL_MODE=1 disables npm updates/upgrade, sync and alias prompts; UI port is strict.

${pc.bold("IDs:")} Use any unique prefix (e.g. "a3f" for "a3f1b2").
`.trim();

export function helpCommand(): void {
  console.log("Projects: dagdo projects [--json]. Task commands accept --project <ID> (required with multiple projects).\n");
  console.log(HELP);
}
