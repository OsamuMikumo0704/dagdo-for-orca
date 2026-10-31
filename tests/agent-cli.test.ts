import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { startServer } from "../src/server/server";

const launcher = resolve(import.meta.dir, "../scripts/dagdo.ts");
setDefaultTimeout(60_000);

describe("agent CLI through the Bun launcher", () => {
  let dir: string, caller: string, previous: string | undefined;
  beforeEach(() => {
    previous = process.env.DAGDO_DATA_DIR;
    dir = mkdtempSync(join(tmpdir(), "dagdo-agent-"));
    caller = join(dir, "caller"); mkdirSync(caller);
    process.env.DAGDO_DATA_DIR = dir;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.DAGDO_DATA_DIR; else process.env.DAGDO_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  });

  const run = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, "run", launcher, ...args], { cwd: caller, env: { ...process.env, DAGDO_DATA_DIR: dir }, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { out, err, code };
  };
  const ok = async (...args: string[]) => {
    const result = await run(...args, "--json");
    expect(result.code, result.err).toBe(0);
    return JSON.parse(result.out);
  };
  const fails = async (code: string, ...args: string[]) => {
    const before = existsSync(join(dir, "data.json")) ? readFileSync(join(dir, "data.json"), "utf8") : undefined;
    const result = await run(...args, "--json");
    expect(result.code, result.out).toBe(1);
    expect(JSON.parse(result.err).error).toBe(code);
    // Failures release the lock and leave the data untouched.
    expect(existsSync(join(dir, ".data.lock"))).toBe(false);
    if (before !== undefined) expect(readFileSync(join(dir, "data.json"), "utf8")).toBe(before);
  };
  const add = async (...args: string[]) => (await ok("add", ...args)).task;

  it("keeps the launcher's local mode and the caller's directory", async () => {
    const upgrade = await run("upgrade");
    expect(upgrade.code).toBe(1);
    expect(upgrade.err).toContain("disabled");
    writeFileSync(join(caller, "relative-note.txt"), "From the caller");
    expect((await add("Relative", "--note-file", "relative-note.txt")).notes).toBe("From the caller");
  });

  it("creates, edits, completes, reopens and removes tasks with effective state", async () => {
    const a = await add("日本語タスク 'quoted'");
    expect(a).toMatchObject({ title: "日本語タスク 'quoted'", state: "ready", progress: "ready", blockedBy: [], dependents: [] });
    expect(a.id).toMatch(/^[0-9a-f]{6}$/);
    const b = await add("Second", "--after", a.id, "--note", "Criteria");
    expect(b).toMatchObject({ state: "blocked", blockedBy: [a.id], dependsOn: [a.id], notes: "Criteria" });

    expect((await ok("edit", b.id, "--progress", "in_progress", "--title", "  Renamed  ")).task).toMatchObject({ title: "Renamed", progress: "in_progress", state: "blocked" });
    expect((await ok("edit", b.id, "--clear-note")).task.notes).toBeUndefined();

    await fails("task_blocked", "done", b.id);
    const done = await ok("done", a.id);
    expect(done.tasks[0].state).toBe("done");
    expect(done.unblocked).toEqual([{ id: b.id, title: "Renamed" }]);
    await fails("already_done", "done", a.id);

    const reopened = await ok("reopen", a.id);
    expect(reopened.tasks[0]).toMatchObject({ doneAt: null, state: "ready", dependents: [b.id] });
    expect(reopened.blocked).toEqual([{ id: b.id, title: "Renamed" }]);
    await fails("not_done", "reopen", a.id);
    expect((await ok("show", b.id)).task).toMatchObject({ id: b.id, state: "blocked", dependsOn: [a.id] });
    expect((await run("show", b.id)).out).toContain("Depends on:");

    await fails("has_dependents", "rm", a.id);
    expect((await ok("rm", a.id, b.id)).removed.map((t: any) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(await ok("list", "--all")).toEqual([]);
  });

  it("reports a batch completion once, after saving", async () => {
    const a = await add("A"), b = await add("B", "--after", a.id), c = await add("C");
    const denied = await run("done", c.id, "missing");
    expect(denied.code).toBe(1);
    expect(denied.out).toBe("");
    const done = await ok("done", a.id, b.id, a.id);
    expect(done.tasks.map((t: any) => t.id)).toEqual([a.id, b.id]);
    expect(done.unblocked).toEqual([]);
  });

  it("rejects invalid dependencies and input without writing", async () => {
    const a = await add("A"), b = await add("B", "--after", a.id);
    await fails("cycle", "add", "Closes a cycle", "--after", b.id, "--before", a.id);
    await fails("cycle", "link", a.id, "--after", b.id);
    await fails("self_loop", "link", a.id, "--before", a.id);
    await fails("already_exists", "link", a.id, "--before", b.id);
    await fails("already_exists", "add", "Duplicate edge", "--after", a.id, "--after", a.id);
    await fails("invalid_input", "link", a.id, "--before", b.id, "--after", b.id);
    await fails("not_found", "unlink", a.id, (await add("Unrelated")).id);
    await fails("empty_patch", "edit", a.id);
    await fails("invalid_title", "edit", a.id, "--title", "   ");
    await fails("invalid_title", "add", "   ");
    await fails("invalid_progress", "edit", a.id, "--progress", "review");
    await fails("invalid_input", "edit", a.id, "--note", "x", "--clear-note");
    await fails("task_not_found", "show", "ffffff0");
    await fails("invalid_input", "done", a.id, "--force");
    await fails("unknown_command", "frobnicate");
  });

  it("does not let an empty ID select the only task", async () => {
    await add("Only task");
    await fails("invalid_input", "rm", "");
    await fails("invalid_input", "done", "");
    expect(await ok("list")).toHaveLength(1);
  });

  it("reads exact note text from a file", async () => {
    const note = 'Line "one"\n日本語 $(not expanded)';
    const file = join(caller, "note.txt");
    writeFileSync(file, "﻿" + note + "\r\n");
    const task = await add("Quoted", "--note-file", file);
    expect(task.notes).toBe(note);
    writeFileSync(file, "x".repeat(2001));
    await fails("note_too_long", "edit", task.id, "--note-file", file);
    await fails("invalid_input", "edit", task.id, "--note-file", join(caller, "missing.txt"));
    await fails("invalid_input", "edit", task.id, "--note", "x", "--note-file", file);
  });

  it("links completed tasks and exposes the whole graph", async () => {
    const a = await add("A"), b = await add("B");
    await ok("done", a.id);
    expect((await ok("link", a.id, "--before", b.id)).edge).toEqual({ from: a.id, to: b.id });
    expect((await ok("show", b.id)).task).toMatchObject({ state: "ready", dependsOn: [a.id], blockedBy: [] });
    expect(await ok("graph")).toMatchObject({ tasks: [{ id: b.id }], edges: [] });
    const all = await ok("graph", "--all");
    expect(all.tasks).toHaveLength(2);
    expect(all.edges).toEqual([{ from: a.id, to: b.id }]);
    expect((await ok("unlink", b.id, a.id)).edge).toEqual({ from: a.id, to: b.id });
  });

  it("manages projects and requires a selection once several exist", async () => {
    await add("In default");
    const { project } = await ok("projects", "add", "Second", "project");
    expect(project.name).toBe("Second project");
    await fails("project_required", "list");
    await fails("invalid_name", "projects", "add", "   ");
    await fails("project_not_found", "projects", "rename", "missing", "Name");
    expect((await ok("projects", "rename", project.id, "Renamed", "again")).project.name).toBe("Renamed again");
    expect(await ok("projects")).toEqual([
      { id: "default", name: "Default", taskCount: 1 },
      { id: project.id, name: "Renamed again", taskCount: 0 },
    ]);
    const scoped = (await ok("add", "In second", "--project", project.id)).task;
    expect((await ok("list", "--project", project.id)).map((t: any) => t.id)).toEqual([scoped.id]);
    await fails("project_not_found", "list", "--project", "missing");
    await fails("project_not_empty", "projects", "rm", project.id);
    expect((await ok("projects", "rm", project.id, "--force")).project.id).toBe(project.id);
    await fails("project_not_empty", "projects", "rm", "default");
    await fails("last_project", "projects", "rm", "default", "--force");
  });

  it("shares the browser's undo history while the server runs", async () => {
    await fails("server_not_running", "undo");
    const server = await startServer({ preferredPort: 0 });
    const titles = async () => (await (await fetch(`${server.url}/api/projects/default/graph`, { proxy: "" })).json() as any).tasks.map((t: any) => t.title);
    try {
      await fails("history_empty", "undo");
      await add("Visible in the browser");
      expect(await titles()).toEqual(["Visible in the browser"]);
      expect(await ok("undo")).toMatchObject({ project: { id: "default" }, canUndo: false, canRedo: true });
      expect(await titles()).toEqual([]);
      expect(await ok("redo")).toMatchObject({ canUndo: true, canRedo: false });
      expect(await titles()).toEqual(["Visible in the browser"]);
      await fails("history_empty", "redo");
    } finally { await server.stop(); }
    expect(existsSync(join(dir, ".server.json"))).toBe(false);
    await fails("server_not_running", "undo");
  });

  it("ignores a stale server record", async () => {
    const server = await startServer({ preferredPort: 0 });
    try {
      // A force-stopped server leaves its record; the port can then belong to another server.
      writeFileSync(join(dir, ".server.json"), JSON.stringify({ url: server.url, pid: 2147483646 }));
      await fails("server_not_running", "undo");
    } finally { await server.stop(); }
  });
});
