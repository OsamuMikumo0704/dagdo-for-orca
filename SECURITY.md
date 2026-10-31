# Security policy

Security fixes target the latest `main` revision. There is no LTS release line.

Report suspected vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/OsamuMikumo0704/dagdo-for-orca/security/advisories/new).
Include a minimal reproduction with fictional data, the source revision, OS and
Bun version. Never publish working credentials or private task data in an issue.

The HTTP server binds to `127.0.0.1`. It is a single-user local application with
no login or multi-user permission system. Do not expose it through a public
reverse proxy, port forwarding or a shared server. The task store and backups are
plain JSON, not encrypted; protect them with OS account and disk permissions.
Optional Orca commands run with your local account's permissions, including
project setup hooks. Review projects and hooks before running them.

No API key, account or cloud task service is required for core use. The supported
launchers disable legacy upstream npm updates, upgrades, sync and alias prompts.
Dependency installation, Git updates and optional browser downloads use the network.

GitHub secret scanning and push protection should remain enabled. CI runs
Gitleaks against history and tracked files. Scanners cannot guarantee the absence
of every secret or personal detail: review staged files before pushing.

If a secret is published, revoke or rotate it first. Removing a file or rewriting
Git history does not revoke credentials or remove existing clones and caches.
Keep `.env*`, keys, task stores, logs, backups and agent sessions out of commits.
