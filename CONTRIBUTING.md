# Contributing

Bug reports, documentation, translations and pull requests are welcome. Use this
fork's [issue tracker](https://github.com/OsamuMikumo0704/dagdo-for-orca/issues).
For vulnerabilities, follow [SECURITY.md](SECURITY.md).

Install [Bun](https://bun.sh/docs/installation) 1.4.4 or newer and Git. Clone the
repository, run `bun install --frozen-lockfile`, then `bun run check`.
Windows contributors should use `scripts/check.ps1` to also test PowerShell.
CI checks Windows PowerShell 5.1, PowerShell 7, macOS and Linux.

Use a linked Git worktree for development; it automatically gets fictional tasks
and separate backups in `.dagdo-dev/`. Never copy production task data into tests,
issues or screenshots. Before source changes in an existing installation, stop
the UI and agent writers and run `bun run backup` (Windows: `scripts/backup.ps1`).
Tests must use a temporary process-local `DAGDO_DATA_DIR`.

Read [AGENTS.md](AGENTS.md), [architecture](docs/architecture.md) and
[operations](docs/operations.md). Keep browser actions accessible through the CLI;
update `src/commands/help.ts`, `README.md` and `skills/dagdo/SKILL.md` together.
All generated application text stays English. Preserve the language of user content.

For translations, add `docs/README.<language-code>.md`, link it from the English
README and translate setup, data storage, backups and the first task workflow.
Keep executable commands and option names unchanged. State that the UI is English.

Keep changes focused, explain their behavior, and include relevant validation.
Contributions are provided under the repository's MIT license. Retain upstream
copyright and attribution. Use a GitHub noreply commit email if you prefer not to
publish your personal email. Never attach unredacted scanner reports or backups.

To regenerate the README screenshot, build the UI, install the Playwright Chromium
browser, then run `bun run scripts/capture-demo.ts`. It uses only fictional tasks
in a temporary store. `DAGDO_BROWSER_EXECUTABLE` can select an installed browser.
