import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { globalDataDir, globalDataFile, withGraphLock, loadGraph, saveGraph, validateGraph, readStore, validateStore } from "../src/storage";
import { environment } from "../src/environment";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backups = process.env.DAGDO_BACKUP_DIR ? resolve(process.env.DAGDO_BACKUP_DIR) : environment().backupDir;
async function snapshot() {
  const graph = readStore();
  mkdirSync(backups, { recursive: true });
  const name = new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomUUID().slice(0,8);
  const folder = join(backups, name + ".partial");
  mkdirSync(folder);
  writeFileSync(join(folder, "data.json"), JSON.stringify(graph, null, 2) + "\n");
  const hasGit = existsSync(join(app, ".git")) && !!Bun.which("git");
  const revision = hasGit ? Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: app }).stdout.toString().trim() : "";
  const dirty = hasGit ? !!Bun.spawnSync(["git", "status", "--porcelain"], { cwd: app }).stdout.toString().trim() : false;
  writeFileSync(join(folder, "metadata.json"), JSON.stringify({ createdAt: new Date().toISOString(), revision, dirty, bun: Bun.version, dataDir: globalDataDir() }, null, 2));
  const complete = join(backups, name); renameSync(folder, complete);
  const generations = readdirSync(backups).filter(n => /^\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9]{8}$/.test(n)).sort().reverse();
  for (const old of generations.slice(30)) {
    const target = resolve(backups, old);
    if (dirname(target) !== resolve(backups)) throw new Error("Invalid backup path");
    rmSync(target, { recursive: true });
  }
  console.log(complete); return complete;
}
await withGraphLock(async () => {
  switch (process.argv[2]) {
    case "init": await loadGraph(); if (!existsSync(globalDataFile())) await saveGraph({version:1,tasks:[],edges:[]}); break;
    case "backup": await snapshot(); break;
    case "restore": {
      const input = resolve(process.argv[3] ?? "");
      if (dirname(input) !== resolve(backups)) throw new Error("Choose a generation inside " + backups);
      const graph: unknown = JSON.parse(readFileSync(join(input, "data.json"), "utf8")); if ((graph as any).version === 2) validateStore(graph); else validateGraph(graph);
      // Preserve current bytes even if the current file is damaged.
      if (existsSync(globalDataFile())) {
        const rescue = join(backups, "before-restore-" + Date.now()); mkdirSync(rescue);
        writeFileSync(join(rescue, "data.json"), readFileSync(globalDataFile()));
      }
      const temp = globalDataFile() + ".restore-" + crypto.randomUUID() + ".tmp";
      try { writeFileSync(temp, JSON.stringify(graph,null,2)+"\n"); renameSync(temp,globalDataFile()); }
      finally { if(existsSync(temp)) rmSync(temp); }
      console.log("Restored " + input); break;
    }
    default: throw new Error("Expected init, backup or restore <generation>");
  }
});
