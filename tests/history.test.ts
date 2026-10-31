import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ProjectHistory } from "../src/server/history";
import type { GraphData } from "../src/types";
import { startServer } from "../src/server/server";
import { withGraphLock, withProject, loadGraph, saveGraph } from "../src/storage";

const empty: GraphData = { version: 1, tasks: [], edges: [] };
const task = { id: "abcdef", title: "Task", progress: "ready" as const, createdAt: "2026-01-01T00:00:00Z", doneAt: null };
describe("shared map history", () => {
  it("deduplicates updates, caps history, and discards redo after a new edit", () => {
    const h = new ProjectHistory(empty);
    for (let i = 0; i < 105; i++) h.observe({ ...empty, tasks: [{ ...task, title: String(i) }] });
    const revision = h.state().revision;
    h.observe(h.state().graph); expect(h.state().revision).toBe(revision);
    let count = 0;
    while (h.state().canUndo) { h.commit("undo", h.target("undo")!); count++; }
    expect(count).toBe(100); expect(h.state().canRedo).toBe(true);
    h.place("tree", { abcdef: { x: 10, y: 20 } });
    expect(h.state().canRedo).toBe(false);
    h.commit("undo", h.target("undo")!); expect(h.state().positions.tree).toEqual({});
    h.commit("redo", h.target("redo")!); expect(h.state().positions.tree.abcdef).toEqual({ x: 10, y: 20 });
  });

  it("shares API and external changes, restores a selection atomically, and rejects stale requests", async () => {
    const dir = mkdtempSync(join(tmpdir(), "dagdo-history-"));
    const previous = process.env.DAGDO_DATA_DIR; process.env.DAGDO_DATA_DIR = dir;
    const server = await startServer({ preferredPort: 0 });
    const base = `${server.url}/api/projects/default`;
    const request = async (path: string, method = "GET", body?: unknown) => fetch(base + path, { method, headers: { "Content-Type": "application/json", Origin: server.url }, body: body === undefined ? undefined : JSON.stringify(body) });
    const state = async () => (await request("/history")).json() as Promise<any>;
    const move = async (direction: string) => request(`/history/${direction}`, "POST", { revision: (await state()).revision });
    try {
      expect((await state()).canUndo).toBe(false);
      const a = (await (await request("/tasks", "POST", { title: "A", placement: { mode: "mindmap", x: 12, y: 34 } })).json() as any).task;
      const b = (await (await request("/tasks", "POST", { title: "B" })).json() as any).task;
      await request("/edges", "POST", { from: a.id, to: b.id });
      const before = await state();
      expect(before.positions.mindmap[a.id]).toEqual({ x: 12, y: 34 });
      expect((await request("/selection", "DELETE", { revision: before.revision, tasks: [a.id, b.id], edges: [] })).status).toBe(200);
      expect((await state()).graph.tasks).toHaveLength(0);
      await move("undo"); expect((await state()).graph).toEqual(before.graph);
      await move("redo"); expect((await state()).graph.tasks).toHaveLength(0);
      await move("undo");
      const stale = (await state()).revision;
      await withProject("default", () => withGraphLock(async () => {
        const graph = await loadGraph(); graph.tasks[0]!.title = "External edit"; await saveGraph(graph);
      }));
      expect((await request("/history/undo", "POST", { revision: stale })).status).toBe(409);
      expect((await state()).graph.tasks[0].title).toBe("External edit");
      await move("undo"); expect((await state()).graph.tasks[0].title).toBe("A");
      expect((await state()).canRedo).toBe(true);
      await request(`/tasks/${a.id}`, "PATCH", { title: "New branch" });
      expect((await state()).canRedo).toBe(false);
      expect((await request("/positions", "PATCH", { revision: (await state()).revision, mode: "tree", positions: { [a.id]: { x: 50, y: 70 } } })).status).toBe(200);
      await move("undo"); expect((await state()).positions.tree).toEqual({});
      const other = (await (await fetch(server.url + "/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Other" }) })).json() as any).project;
      expect((await (await fetch(`${server.url}/api/projects/${other.id}/history`)).json() as any).canUndo).toBe(false);
      expect((await fetch(base + "/history/undo", { method: "POST" })).status).toBe(403);
      await withProject("default", () => withGraphLock(async () => {
        const graph = await loadGraph();
        graph.tasks[0]!.progress = "in_progress";
        graph.tasks[0]!.orcaCreation = { requestId: "pending", setupId: "setup", repoId: "repo", name: "Workspace", setup: "skip", startedAt: "2026-01-01T00:00:00Z" };
        await saveGraph(graph);
      }));
      const protectedState = await state();
      expect((await move("undo")).status).toBe(409);
      expect(await state()).toEqual(protectedState);
      await server.stop();
      const restarted = await startServer({ preferredPort: 0 });
      try { expect((await (await fetch(`${restarted.url}/api/projects/default/history`)).json() as any).canUndo).toBe(false); }
      finally { await restarted.stop(); }
    } finally {
      await server.stop();
      if (previous === undefined) delete process.env.DAGDO_DATA_DIR; else process.env.DAGDO_DATA_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
