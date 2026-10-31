# Local Windows workflow

- Cross-platform operations are documented in docs/operations.md. Bun-only start, backup, restore and check commands are available on every OS; use scripts/check.ps1 on Windows to include launcher tests.

- Humans use the browser; agents use scripts/dagdo.ts through Bun, from any shell. From the repository root: bun run scripts/dagdo.ts next. All scripts/*.ps1 support Windows PowerShell 5.1 and PowerShell 7.
- Never directly edit the real data/data.json. All writers must use withGraphLock before loading, modifying and saving.
- Stop the UI and agent writes, then run scripts/backup.ps1 before changing the source.
- Tests and manual checks must use temporary DAGDO_DATA_DIR paths, never real task data. Do not set DAGDO_DATA_DIR globally.
- Additional Git worktrees automatically use isolated sample data in .dagdo-dev/; start/stop and backups are worktree-local. Main worktree defaults remain production.
- Use scripts/check.ps1 for tests, types and UI build. Restart after a successful build.
- Keep help, README and skills/dagdo/SKILL.md in sync when changing CLI behavior. A new browser action needs a matching CLI command so agents keep parity.
- No npm publication or cloud task sync in this setup.
- Read docs/windows-local.md for operations and docs/architecture.md for the repository map and change guide.
- All application-generated text must be in English, including UI labels, statuses, dialogs, messages, dates, sample content, and CLI output. Preserve user-entered content in its original language.
