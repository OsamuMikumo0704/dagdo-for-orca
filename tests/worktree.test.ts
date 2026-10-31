import { expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, openSync, closeSync, realpathSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { resolveEnvironment } from "../src/environment";

it("linked worktrees isolate direct CLI data, seed once, and honor explicit overrides", async () => {
  // macOS /var aliases and Windows short home names resolve to the same store.
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dagdo worktrees \u65e5\u672c\u8a9e ")));
  const main = join(root, "app"); mkdirSync(main);
  const source = resolve(import.meta.dir, "..");
  for (const name of ["src", "scripts", "package.json"]) cpSync(join(source, name), join(main, name), { recursive: true });
  const git = (...args: string[]) => {
    const p = Bun.spawnSync(["git", "-C", main, ...args]);
    expect(p.exitCode, p.stderr.toString()).toBe(0);
  };
  git("init"); git("add", "."); git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "fixture");
  const a = join(root, "a"), b = join(root, "nested", "b");
  git("worktree", "add", "-b", "feat/a", a); git("worktree", "add", "-b", "feat/b", b);
  for (const app of [main, a, b]) symlinkSync(join(source, "node_modules"), join(app, "node_modules"), "junction");
  expect(resolveEnvironment(main).development).toBe(false);
  expect(resolveEnvironment(a).dataDir).toBe(join(a, ".dagdo-dev", "data"));
  expect(resolveEnvironment(b).dataDir).toBe(join(b, ".dagdo-dev", "data"));
  expect(resolveEnvironment(a).mutex).not.toBe(resolveEnvironment(b).mutex);
  const env = { ...process.env }; delete env.DAGDO_DATA_DIR; delete env.DAGDO_BACKUP_DIR;
  const cli = async (app: string, args: string[], extra = {}) => {
    const child = Bun.spawn([process.execPath, join(app, "src/cli.ts"), ...args], { cwd: root, env: { ...env, ...extra }, stdout: "pipe", stderr: "pipe" });
    const out = await new Response(child.stdout).text(), err = await new Response(child.stderr).text();
    expect(await child.exited, err).toBe(0); return out;
  };
  mkdirSync(join(root, "data"));
  const production = '{"version":1,"tasks":[],"edges":[]}';
  writeFileSync(join(root, "data/data.json"), production);
  await Promise.all([cli(a, ["list"]), cli(a, ["add", "kept edit"]), cli(b, ["list"])]);
  const graph = (app: string) => JSON.parse(readFileSync(join(app, ".dagdo-dev/data/data.json"), "utf8")).projects[0];
  expect(graph(a).tasks).toHaveLength(4); expect(graph(b).tasks).toHaveLength(3);
  await cli(a, ["list"]); expect(graph(a).tasks).toHaveLength(4);
  expect(graph(a).edges).toHaveLength(1);
  const override = join(root, "explicit-data");
  await cli(a, ["add", "explicit"], { DAGDO_DATA_DIR: override });
  expect(JSON.parse(readFileSync(join(override, "data.json"), "utf8")).projects[0].tasks).toHaveLength(1);
  expect(readFileSync(join(root, "data/data.json"), "utf8")).toBe(production);
  expect(() => resolveEnvironment(root)).toThrow();
  if (process.env.DAGDO_TEST_PWSH) {
    const script = async (app: string, name: string, args: string[] = []) => {
      // Background Windows servers can inherit pipe handles. Use files so
      // collecting launcher output does not wait for the server to terminate.
      const outPath = join(root, "script-out"), errPath = join(root, "script-err");
      const outFd = openSync(outPath, "w"), errFd = openSync(errPath, "w");
      try {
        const child = Bun.spawn([process.env.DAGDO_TEST_PWSH!, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(app, "scripts", name + ".ps1"), ...args], { cwd: app, env, stdin: "ignore", stdout: outFd, stderr: errFd });
        expect(await child.exited, readFileSync(errPath, "utf8")).toBe(0);
        return readFileSync(outPath, "utf8").trim();
      } finally { closeSync(outFd); closeSync(errFd); }
    };
    for (const app of [a, b]) {
      mkdirSync(join(app, "dist/web"), { recursive: true });
      writeFileSync(join(app, "dist/web/index.html"), "<html>fixture</html>");
    }
    const state = (app: string) => JSON.parse(readFileSync(join(app, ".dagdo-dev/local/runtime/server.json"), "utf8"));
    try {
      await script(a, "start", ["-NoOpen"]); await script(b, "start", ["-NoOpen"]);
      const sa = state(a), sb = state(b);
      expect(sa.url).not.toBe(sb.url);
      expect(Number(new URL(sa.url).port)).toBeGreaterThanOrEqual(3738);
      expect((await (await fetch(sa.url + "/api/projects/default/graph")).json() as any).tasks).toHaveLength(4);
      expect((await (await fetch(sb.url + "/api/projects/default/graph")).json() as any).tasks).toHaveLength(3);
      await script(a, "start", ["-NoOpen"]); expect(state(a).pid).toBe(sa.pid);
      const backup = await script(a, "backup");
      expect(backup.startsWith(join(a, ".dagdo-dev/backups"))).toBe(true);
      await script(a, "dagdo", ["add", "restore me"]);
      await script(a, "stop");
      expect((await fetch(sb.url + "/api/projects/default/graph")).ok).toBe(true);
      await script(a, "restore", ["-Generation", backup, "-WritesStopped"]);
      expect(graph(a).tasks).toHaveLength(4);
      await script(a, "start", ["-NoOpen"]);
      expect((await fetch(state(a).url + "/api/projects/default/graph")).ok).toBe(true);
      expect(readFileSync(join(root, "data/data.json"), "utf8")).toBe(production);
    } finally { await script(a, "stop"); await script(b, "stop"); }
  }
}, 60000);
