# Cross-platform operations

[README](../README.md) · [Windows background launchers](windows-local.md)

## Requirements and paths

Install Bun 1.4.4 or newer using its [official instructions](https://bun.sh/docs/installation).
Git is needed for cloning, updates and linked worktrees. Source ZIPs work without
Git metadata. In a ZIP installation, backup source-revision metadata is empty.

Use a dedicated parent folder containing `app/` (source), `data/` (tasks),
`backups/`, and `local/` (Windows background runtime). Main checkout launchers
share that parent folder. Linked Git worktrees instead use `.dagdo-dev/` inside
each checkout; they initialize fictional sample tasks once and select ports from
3738. No production data is copied into worktrees.

Process-local `DAGDO_DATA_DIR` and `DAGDO_BACKUP_DIR` overrides take precedence.
Set them only for the relevant command/session, never in user-wide settings.
Use the same data override for the browser, CLI and backups. The historical
direct `src/cli.ts` entry point uses a different default store and is unsupported
for daily use; use `scripts/dagdo.ts` or the package scripts instead.

## Daily commands (PowerShell, Bash or Zsh)

```sh
bun run start
bun run start --no-open --port 3837
bun run scripts/dagdo.ts next --json
bun run scripts/dagdo.ts projects --json
bun run backup
```

Run one start command at a time. Portable startup backs up before launching the
UI and stays in the foreground. Keep the terminal open; stop with Ctrl+C or the
browser's **Shut down** action. The default main-checkout port is 3737 and a port
conflict fails. Windows users can instead use `scripts/start.ps1` and
`scripts/stop.ps1` for background operation; see the Windows guide for logs.

## Backup and restore

Backup takes the same data lock as CLI/HTTP writers, records the source revision
and retains 30 completed generations. Backup metadata contains the local data
path. Treat backup directories as private; they are not source artifacts.

1. Stop the UI and all agents or terminals that write task data.
2. Choose a completed generation directly inside the configured backup directory.
3. Restore, explicitly acknowledging that writers are stopped:

```sh
bun run restore /absolute/path/to/dagdo/backups/GENERATION --writes-stopped
bun run start
```

Use quotes around paths containing spaces. The portable restore refuses a live
recorded server and validates the backup. It saves current raw bytes in a
`before-restore-*` rescue folder first, even if damaged. Rescue copies are not
automatically pruned. Never restore while another writer is active. When rolling
back a schema change, restore compatible source and task data together.

Backups on the same drive do not protect against drive failure. Copy them to
separate private storage when needed. Data and backups are unencrypted JSON.

## Development and updates

Stop the UI and agent writes, back up, edit/update source, then run:

```sh
bun install --frozen-lockfile
bun run check
bun run start
```

Windows contributors run `scripts/check.ps1` to also exercise PowerShell native
argument handling. Tests and checks use temporary task directories. Never point
tests at production data. To develop with fictional data, use a linked worktree.
Keep `.env*`, keys, task data, logs, backups and local agent settings out of Git.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Bun is not found | Restart the shell after installation and check that Bun's bin directory is on PATH. |
| No UI build | Run `bun run build` before startup. |
| Port in use | Stop the existing instance or pass `--port 3837`. Do not kill an unidentified process. |
| Browser does not open | Open the printed URL yourself; on Linux install `xdg-utils`, or use `--no-open`. |
| Task data differs between CLI and browser | Use the same checkout's launcher and process-local overrides. |
| Invalid task JSON | Preserve the file and restore a valid backup. Do not replace it with an empty graph. |
| Lock timeout | Stop writers and inspect the lock owner. Only dead-process locks are reclaimed automatically. |
| ZIP cannot update with Git | Download a fresh ZIP and replace source after backup, or switch to a clone. |
| Orca unavailable | Core task management works without Orca. Put its CLI on PATH or set process-local `DAGDO_ORCA_COMMAND` to the executable path. |

Optional PNG/SVG rendering uses rendering packages. Mermaid image export also
needs a Playwright browser: `bunx playwright install chromium`. Linux may need
the OS packages reported by Playwright. ASCII/Mermaid text exports need no browser.
The web UI itself does not require Playwright. Orca integration depends on a
compatible local Orca installation and ready Git project; remote environments
are excluded. See the [agent workspace reference](../skills/dagdo/references/orca-workspaces.md).
