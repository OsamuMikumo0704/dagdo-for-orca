import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve, join, delimiter, dirname } from "path";

const directory = mkdtempSync(join(tmpdir(), "dagdo-check-"));
try {
  for (const args of [["test"], ["run", "typecheck"], ["run", "build:web"]]) {
    const child = Bun.spawn([process.execPath, ...args], {
      cwd: resolve(import.meta.dir, ".."),
      env: { ...process.env, DAGDO_DATA_DIR: directory, DAGDO_BACKUP_DIR: join(directory, "backups"),
        DAGDO_LOCAL_MODE: "0", PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? "") },
      stdin: "inherit", stdout: "inherit", stderr: "inherit",
    });
    const code = await child.exited;
    if (code !== 0) { process.exitCode = code; break; }
  }
} finally { rmSync(directory, { recursive: true, force: true }); }
