import { existsSync, realpathSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

export function resolveEnvironment(app = resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  app = realpathSync(app);
  // GitHub source ZIPs have no Git metadata. Do not inspect an enclosing repo.
  if (!existsSync(join(app, ".git"))) {
    const manifest = join(app, "package.json");
    if (!existsSync(manifest) || JSON.parse(readFileSync(manifest, "utf8")).name !== "dagdo-local") {
      throw new Error("Cannot determine application environment");
    }
    return context(app, false);
  }
  const result = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], { cwd: app });
  if (result.exitCode !== 0) throw new Error("Cannot determine Git worktree environment: " + result.stderr.toString());
  const [gitDir, commonDir] = result.stdout.toString().trim().split(/\r?\n/);
  if (!gitDir || !commonDir || !existsSync(gitDir) || !existsSync(commonDir)) throw new Error("Invalid Git worktree paths");
  const normalize = (path: string) => process.platform === "win32" ? realpathSync(path).toLowerCase() : realpathSync(path);
  const development = normalize(gitDir) !== normalize(commonDir);
  return context(app, development);
}

function context(app: string, development: boolean) {
  const root = development ? join(app, ".dagdo-dev") : dirname(app);
  return { development, root, dataDir: join(root, "data"), backupDir: join(root, "backups"),
    mutex: development ? "Local\\dagdo-dev-" + createHash("sha256").update(app.toLowerCase()).digest("hex").slice(0, 24) : "Local\\dagdo-for-orca-local-server" };
}

let cached: ReturnType<typeof resolveEnvironment> | undefined;
export function environment() { return cached ??= resolveEnvironment(); }
