import { it, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { startServer } from "../src/server/server";
import { loadGraph, saveGraph, withGraphLock } from "../src/storage";
import { computeTaskStates } from "../src/task-state";
import type { GraphData } from "../src/types";

it("migrates old tasks and preserves progress through dependency and completion changes across API and CLI", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dagdo-progress-"));
  const original = process.env.DAGDO_DATA_DIR;
  process.env.DAGDO_DATA_DIR = dir;
  const cli = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, resolve("src/cli.ts"), ...args], {
      env: { ...process.env, DAGDO_LOCAL_MODE: "1", DAGDO_DATA_DIR: dir }, stdout: "pipe", stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { out, err, code };
  };
  let srv: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    const legacy = { version: 1, tasks: [
      { id: "aaa111", title: "Predecessor", priority: "high", createdAt: "2026-01-01", doneAt: null },
      { id: "bbb222", title: "Successor", priority: "low", createdAt: "2026-01-02", doneAt: null },
      { id: "ccc333", title: "Completed", priority: "med", createdAt: "2026-01-03", doneAt: "2026-01-04" },
    ], edges: [{ from: "aaa111", to: "bbb222" }] };
    // Seed only isolated test data, under the same lock used by application writers.
    await withGraphLock(async () => writeFileSync(join(dir, "data.json"), JSON.stringify(legacy)));
    const loaded = await loadGraph();
    expect(loaded.tasks.every(t => t.progress === "ready" && !("priority" in t))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "data.json"), "utf8"))).toEqual(legacy); // read-only migration
    expect(loaded.tasks[2]!.doneAt).toBe("2026-01-04");
    srv = await startServer({ preferredPort: 0 });
    const request = (path: string, method: string, body: unknown) => fetch(srv!.url + path, {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), proxy: "",
    });
    const graph = async () => (await (await fetch(srv!.url + "/api/projects/default/graph", { proxy: "" })).json()) as GraphData;
    const state = async (id: string) => { const g = await graph(); return computeTaskStates(g.tasks, g.edges).get(id); };
    for (const method of ["POST", "PATCH"]) {
      const path = method === "POST" ? "/api/projects/default/tasks" : "/api/projects/default/tasks/aaa111";
      for (const invalid of ["working", null, 1]) {
        expect((await request(path, method, { title: "Invalid", progress: invalid })).status).toBe(400);
      }
      expect((await request(path, method, { title: "Legacy", priority: "high" })).status).toBe(400);
    }
    expect((await cli("edit", "bbb222", "--progress", "in_progress")).code).toBe(0);
    expect(await state("bbb222")).toBe("blocked");
    expect((await request("/api/projects/default/tasks/aaa111", "PATCH", { doneAt: "2026-02-01" })).status).toBe(200);
    expect(await state("bbb222")).toBe("in_progress");
    expect((await request("/api/projects/default/tasks/bbb222", "PATCH", { progress: "in_progress" })).status).toBe(200);
    expect((await cli("done", "bbb222")).code).toBe(0);
    expect(await state("bbb222")).toBe("done");
    await request("/api/projects/default/tasks/bbb222", "PATCH", { doneAt: null });
    expect(await state("bbb222")).toBe("in_progress");
    await request("/api/projects/default/tasks/aaa111", "PATCH", { doneAt: null });
    expect(await state("bbb222")).toBe("blocked");
    await request("/api/projects/default/edges", "DELETE", { from: "aaa111", to: "bbb222" });
    expect(await state("bbb222")).toBe("in_progress");
    await request("/api/projects/default/edges", "POST", { from: "aaa111", to: "bbb222" });
    expect(await state("bbb222")).toBe("blocked");
    await cli("done", "aaa111");
    expect(await state("bbb222")).toBe("in_progress");
    const next = JSON.parse((await cli("next", "--json")).out);
    expect(next.map((t: { id: string }) => t.id)).toContain("bbb222");
    expect(JSON.parse((await cli("status", "--json")).out)).toMatchObject({ ready: 0, inProgress: 1, blocked: 0, done: 2 });
    expect(JSON.parse((await cli("list", "--json")).out)[0].state).toBe("in_progress");
    expect((await cli("add", "New", "--progress", "in_progress")).code).toBe(0);
    expect((await cli("edit", "bbb222", "--progress", "invalid")).code).toBe(1);
    expect((await cli("add", "Old flag", "--priority", "high")).code).not.toBe(0);
    expect(readFileSync(join(dir, "data.json"), "utf8")).not.toContain('"priority"');
    // Invalid stored progress is rejected rather than silently reset.
    await withGraphLock(async () => {
      const good = await loadGraph();
      const bad = structuredClone(good); (bad.tasks[0] as any).progress = "invalid";
      await expect(saveGraph(bad)).rejects.toThrow();
      expect(await loadGraph()).toEqual(good);
    });
  } finally {
    await srv?.stop();
    if (original === undefined) delete process.env.DAGDO_DATA_DIR;
    else process.env.DAGDO_DATA_DIR = original;
    rmSync(dir, { recursive: true, force: true });
  }
});
