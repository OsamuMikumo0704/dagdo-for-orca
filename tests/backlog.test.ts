import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { startServer } from "../src/server/server";

test("Backlog stays out of the map and next, requires explicit unlinking, and moves atomically", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dagdo-backlog-"));
  const previous = process.env.DAGDO_DATA_DIR;
  process.env.DAGDO_DATA_DIR = directory;
  const server = await startServer({ preferredPort: 0 });
  const request = (path: string, method = "GET", body?: unknown) => fetch(`${server.url}/api/projects/default${path}`, {
    method, headers: { "Content-Type": "application/json", Origin: server.url }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const state = async () => (await request("/history")).json() as Promise<any>;
  const cli = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, resolve("scripts/dagdo.ts"), ...args], { env: { ...process.env, DAGDO_DATA_DIR: directory }, stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, out, err };
  };
  const history = async (direction: string) => expect((await request(`/history/${direction}`, "POST", { revision: (await state()).revision })).status).toBe(200);
  try {
    const added = await cli("add", "Backlog fixture", "--progress", "backlog", "--note", "Keep this note", "--json");
    expect(added.code).toBe(0);
    const task = JSON.parse(added.out).task;
    expect(task.state).toBe("backlog");
    const projectResponse = await fetch(`${server.url}/api/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Other project" }) });
    const otherProject = (await projectResponse.json() as any).project;
    expect((await fetch(`${server.url}/api/projects/${otherProject.id}/tasks/${task.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", Origin: server.url }, body: JSON.stringify({ progress: "ready", placement: { mode: "tree", x: 1, y: 2 } }) })).ok).toBe(false);
    expect((await (await fetch(`${server.url}/api/projects/${otherProject.id}/graph`)).json() as any).tasks).toEqual([]);
    // The CLI requires project selection once another project exists.
    await fetch(`${server.url}/api/projects/${otherProject.id}`, { method: "DELETE" });
    expect(JSON.parse((await cli("next", "--json")).out)).toEqual([]);
    expect((await cli("graph", "--all")).out).not.toContain("Backlog fixture");
    expect(JSON.parse((await cli("status", "--json")).out)).toMatchObject({ backlog: 1, active: 1 });
    expect((await cli("done", task.id, "--json")).code).toBe(1);
    expect((await request(`/tasks/${task.id}`, "PATCH", { doneAt: new Date().toISOString() })).status).toBe(409);
    const before = await state();
    for (const placement of [null, { mode: "invalid", x: 1, y: 2 }, { mode: "tree", x: "1", y: 2 }]) {
      expect((await request(`/tasks/${task.id}`, "PATCH", { progress: "ready", placement })).status).toBe(400);
    }
    expect((await state()).revision).toBe(before.revision);
    expect((await request(`/tasks/${task.id}`, "PATCH", { progress: "ready", placement: { mode: "mindmap", x: 123, y: 456 } })).status).toBe(200);
    const after = await state();
    expect(after.revision).toBe(before.revision + 1);
    expect(after.positions.mindmap[task.id]).toEqual({ x: 123, y: 456 });
    expect(after.graph.tasks[0]).toMatchObject({ id: task.id, notes: task.notes, createdAt: task.createdAt, progress: "ready" });
    expect((await request(`/tasks/${task.id}`, "PATCH", { progress: "ready", placement: { mode: "tree", x: 1, y: 2 } })).status).toBe(409);
    await history("undo");
    expect((await state()).graph.tasks[0].progress).toBe("backlog");
    expect((await state()).positions.mindmap[task.id]).toBeUndefined();
    await history("redo");
    expect((await state()).positions.mindmap[task.id]).toEqual({ x: 123, y: 456 });
    const other = (await (await request("/tasks", "POST", { title: "Other" })).json() as any).task;
    const third = (await (await request("/tasks", "POST", { title: "Third" })).json() as any).task;
    await request("/edges", "POST", { from: other.id, to: task.id });
    await request("/edges", "POST", { from: task.id, to: third.id });
    expect((await cli("edit", task.id, "--progress", "backlog", "--json")).code).toBe(1);
    expect((await request(`/tasks/${task.id}`, "PATCH", { progress: "backlog" })).status).toBe(409);
    expect((await cli("edit", task.id, "--progress", "backlog", "--clear-dependencies", "--json")).code).toBe(0);
    expect((await state()).graph.edges).toEqual([]);
    await history("undo");
    expect((await state()).graph.edges).toHaveLength(2);
    await history("redo");
    expect((await request("/edges", "POST", { from: task.id, to: third.id })).ok).toBe(false);
    expect((await cli("link", task.id, third.id, "--json")).code).toBe(1);
    expect((await cli("edit", task.id, "--progress", "ready", "--json")).code).toBe(0);
    expect((await cli("done", task.id, "--json")).code).toBe(0);
    expect((await cli("edit", task.id, "--progress", "backlog", "--json")).code).toBe(1);
    expect((await cli("reopen", task.id, "--json")).code).toBe(0);
    expect((await cli("edit", task.id, "--progress", "backlog", "--json")).code).toBe(0);
    expect(JSON.parse((await cli("show", task.id, "--json")).out).task.progress).toBe("backlog");
  } finally {
    await server.stop();
    if (previous === undefined) delete process.env.DAGDO_DATA_DIR; else process.env.DAGDO_DATA_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
