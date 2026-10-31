// Runs the CLI with the same data paths and local mode as dagdo.ps1. Bun is the
// only requirement, so agents can call this from any shell.
import { environment } from "../src/environment";

const context = environment();
process.env.DAGDO_DATA_DIR ||= context.dataDir;
process.env.DAGDO_BACKUP_DIR ||= context.backupDir;
process.env.DAGDO_LOCAL_MODE = "1";
process.env.DAGDO_CALLER_CWD ||= process.cwd();
await import("../src/cli");
