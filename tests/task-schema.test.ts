import { it, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { loadGraph, readStore, saveGraph, saveStore, withGraphLock, withProject } from "../src/storage";

it("removes legacy tags across projects while preserving task data and rejects removed CLI flags", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dagdo-schema-"));
  const previous = process.env.DAGDO_DATA_DIR;
  process.env.DAGDO_DATA_DIR = dir;
  const task = {
    id: "abcdef", title: "日本語 task", progress: "in_progress" as const, tags: ["old"],
    notes: "Keep these notes", createdAt: "2026-01-01T00:00:00Z", doneAt: null,
    orcaWorkspace: { identityKey: "wt2:local:test", id: "repo::path", repoId: "repo", projectId: "orca-project", setupId: "setup", path: dir, displayName: "Workspace", branch: "feature/test", createdAt: "2026-01-02T00:00:00Z" },
  };
  const legacy = { version: 2, projects: [
    { id: "first", name: "First", version: 1, tasks: [task], edges: [] },
    { id: "second", name: "Second", version: 1, tasks: [{ ...task, orcaWorkspace: undefined }], edges: [] },
  ] };
  const file = join(dir, "data.json");
  try {
    await withGraphLock(async () => writeFileSync(file, JSON.stringify(legacy)));
    const { tags: _removed, ...retained } = task;
    expect(readStore().projects[0]!.tasks[0]).toEqual(retained);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(JSON.parse(JSON.stringify(legacy)));
    await withProject("first", () => withGraphLock(async () => {
      const graph = await loadGraph();
      graph.tasks[0]!.title = "Updated 日本語 task";
      await saveGraph(graph);
    }));
    const saved = JSON.parse(readFileSync(file, "utf8"));
    expect(saved.projects.every((p: any) => p.tasks.every((t: any) => !("tags" in t)))).toBe(true);
    expect(saved.projects[0].tasks[0]).toEqual({ ...retained, title: "Updated 日本語 task" });
    expect(saved.projects[1].tasks[0].notes).toBe(task.notes);
    // Project metadata writes must also clean older fields in every project.
    await withGraphLock(async () => {
      await saveStore(legacy as unknown as Parameters<typeof saveStore>[0]);
    });
    expect(readFileSync(file, "utf8")).not.toContain('"tags"');
    const before = readFileSync(file, "utf8");
    for (const args of [["add", "Example", "--tag", "old"], ["edit", "abcdef", "--untag", "old"], ["list", "-t", "old"]]) {
      const child = Bun.spawn([process.execPath, resolve("src/cli.ts"), ...args, "--project", "first"], {
        env: { ...process.env, DAGDO_DATA_DIR: dir, DAGDO_LOCAL_MODE: "1" }, stdout: "pipe", stderr: "pipe",
      });
      const [code, , error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect(code).not.toBe(0);
      expect(error).toContain("Unknown option");
    }
    expect(readFileSync(file, "utf8")).toBe(before);
  } finally {
    if (previous === undefined) delete process.env.DAGDO_DATA_DIR; else process.env.DAGDO_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
