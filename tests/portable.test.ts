import { expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { createServer } from "net";
import { resolveEnvironment } from "../src/environment";

it("source archives work without Git, back up, refuse unsafe restores and shut down portably", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dagdo portable \u65e5\u672c\u8a9e ")));
  const source = resolve(import.meta.dir, "..");
  const app = join(root, "app");
  mkdirSync(app);
  for (const name of ["src", "scripts", "package.json"]) cpSync(join(source, name), join(app, name), { recursive: true });
  symlinkSync(join(source, "node_modules"), join(app, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  mkdirSync(join(app, "dist/web"), { recursive: true });
  writeFileSync(join(app, "dist/web/index.html"), "<html>Portable fixture</html>");
  const data = join(root, "private data"), backups = join(root, "private backups");
  // Excluding Git from PATH also checks ZIP startup on a machine without Git.
  const env = { ...process.env, PATH: dirname(process.execPath), DAGDO_DATA_DIR: data, DAGDO_BACKUP_DIR: backups };
  const run = async (script: string, ...args: string[]) => {
    const p = Bun.spawn([process.execPath, join(app, "scripts", script), ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { code, out, err };
  };
  let ui: ReturnType<typeof Bun.spawn> | undefined;
  try {
    expect(resolveEnvironment(app).development).toBe(false);
    expect(resolveEnvironment(app).dataDir).toBe(join(root, "data"));
    const first = await run("dagdo.ts", "add", "Portable Unicode \u65e5\u672c\u8a9e", "--json");
    expect(first.code, first.err).toBe(0);
    const before = readFileSync(join(data, "data.json"), "utf8");
    const backup = await run("manage.ts", "backup");
    expect(backup.code, backup.err).toBe(0);
    const generation = backup.out.trim();
    expect(JSON.parse(readFileSync(join(generation, "metadata.json"), "utf8")).revision).toBe("");
    expect((await run("dagdo.ts", "add", "After backup")).code).toBe(0);
    expect((await run("manage.ts", "restore", generation)).code).toBe(1);
    expect((await run("manage.ts", "restore", root, "--writes-stopped")).code).toBe(1);
    const restored = await run("manage.ts", "restore", generation, "--writes-stopped");
    expect(restored.code, restored.err).toBe(0);
    expect(readFileSync(join(data, "data.json"), "utf8")).toBe(before);
    expect(readdirSync(backups).some(name => name.startsWith("before-restore-"))).toBe(true);

    const probe = createServer();
    await new Promise<void>(r => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r, reject) => probe.close(e => e ? reject(e) : r()));
    ui = Bun.spawn([process.execPath, join(app, "scripts/manage.ts"), "start", "--no-open", "--port", String(port)], { env, stdout: "ignore", stderr: "pipe" });
    const url = `http://localhost:${port}`;
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(url, { proxy: "" })).ok) { ready = true; break; } } catch {}
      if (ui.exitCode !== null) break;
      await Bun.sleep(50);
    }
    expect(ready).toBe(true);
    const denied = await run("manage.ts", "restore", generation, "--writes-stopped");
    expect(denied.code).toBe(1);
    expect(denied.err).toContain("Stop the UI");
    const stopped = await fetch(url + "/api/shutdown", { method: "POST", headers: { Origin: url }, proxy: "" });
    expect(stopped.status).toBe(200);
    expect(await ui.exited).toBe(0);
    ui = undefined;
  } finally {
    if (ui) { ui.kill(); await ui.exited; }
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
