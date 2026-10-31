// Portable local operations. Keep the UI in the foreground so Ctrl+C owns it.
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { environment } from "../src/environment";

const app = resolve(import.meta.dir, "..");
const context = environment();
process.env.DAGDO_DATA_DIR ||= context.dataDir;
process.env.DAGDO_BACKUP_DIR ||= context.backupDir;
process.env.DAGDO_LOCAL_MODE = "1";
const [command, ...args] = process.argv.slice(2);

async function local(...parameters: string[]) {
  const child = Bun.spawn([process.execPath, "run", join(app, "scripts/local.ts"), ...parameters], {
    cwd: app, env: process.env, stdin: "inherit", stdout: "inherit", stderr: "inherit",
  });
  if (await child.exited !== 0) throw new Error("Local operation failed");
}

try {
  switch (command) {
    case "start": {
      if (!existsSync(join(app, "dist/web/index.html"))) throw new Error("Run bun run build before starting the UI.");
      await local("backup");
      const { uiCommand } = await import("../src/commands/ui");
      await uiCommand(args);
      break;
    }
    case "backup":
      if (args.length) throw new Error("Usage: bun run backup");
      await local("backup");
      break;
    case "restore": {
      if (args.length !== 2 || args[1] !== "--writes-stopped") {
        throw new Error("Stop the UI and all agent writes, then use: bun run restore <absolute-generation-path> --writes-stopped");
      }
      const statePath = join(process.env.DAGDO_DATA_DIR!, ".server.json");
      if (existsSync(statePath)) {
        const state = JSON.parse(readFileSync(statePath, "utf8"));
        if (!Number.isInteger(state.pid) || state.pid <= 0) throw new Error("Invalid server state. Verify all writers have stopped before restoring.");
        let alive = true;
        try { process.kill(state.pid, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; else throw error; }
        if (alive) throw new Error("Stop the UI before restoring.");
      }
      await local("restore", args[0]!);
      break;
    }
    default:
      throw new Error("Usage: bun run scripts/manage.ts start [--no-open] [--port <n>] | backup | restore <generation> --writes-stopped");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
