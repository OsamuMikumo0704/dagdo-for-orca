import { describe, it, expect } from "bun:test";
import {
  addEdge,
  addProject,
  addTask,
  removeEdge,
  removeProject,
  removeTask,
  renameProject,
  updateTask,
} from "../src/graph/mutations";
import type { ProjectStore } from "../src/storage";
import type { GraphData, Task } from "../src/types";

function makeData(overrides: Partial<GraphData> = {}): GraphData {
  return { version: 1, tasks: [], edges: [], ...overrides };
}

function task(id: string, extras: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    progress: "ready",
    createdAt: "2026-01-01T00:00:00Z",
    doneAt: null,
    ...extras,
  };
}

describe("project mutations", () => {
  const store = (): ProjectStore => ({ version: 2, projects: [{ id: "one", name: "One", version: 1, tasks: [task("a")], edges: [] }] });

  it("adds a project with a trimmed name and leaves the input unchanged", () => {
    const input = store();
    const result = addProject(input, "  Two  ");
    if (!result.ok) throw new Error(result.error);
    expect(result.project).toMatchObject({ name: "Two", tasks: [], edges: [] });
    expect(result.store.projects.map((p) => p.name)).toEqual(["One", "Two"]);
    expect(input).toEqual(store());
  });

  it("rejects blank names and unknown projects", () => {
    expect(addProject(store(), "   ")).toEqual({ ok: false, error: "invalid_name" });
    expect(renameProject(store(), "one", " ")).toEqual({ ok: false, error: "invalid_name" });
    expect(renameProject(store(), "missing", "Name")).toEqual({ ok: false, error: "project_not_found" });
    expect(removeProject(store(), "missing")).toEqual({ ok: false, error: "project_not_found" });
  });

  it("renames a project and keeps its tasks", () => {
    const result = renameProject(store(), "one", " Renamed ");
    if (!result.ok) throw new Error(result.error);
    expect(result.store.projects).toEqual([{ ...store().projects[0]!, name: "Renamed" }]);
  });

  it("removes a project but never the last one", () => {
    expect(removeProject(store(), "one")).toEqual({ ok: false, error: "last_project" });
    const added = addProject(store(), "Two");
    if (!added.ok) throw new Error(added.error);
    const result = removeProject(added.store, "one");
    if (!result.ok) throw new Error(result.error);
    expect(result.project.name).toBe("One");
    expect(result.store.projects.map((p) => p.name)).toEqual(["Two"]);
  });
});

describe("addTask", () => {
  it("appends a new task with generated id", () => {
    const { data, task } = addTask(makeData(), { title: "t1" });
    expect(data.tasks).toHaveLength(1);
    expect(task.title).toBe("t1");
    expect(task.progress).toBe("ready");
    expect(task.id).toMatch(/^[0-9a-f]{6}$/);
  });

  it("does not mutate the input", () => {
    const input = makeData();
    addTask(input, { title: "t1" });
    expect(input.tasks).toEqual([]);
  });


});

describe("updateTask", () => {
  it("rejects completion while any prerequisite is unfinished without applying other fields", () => {
    const input = makeData({
      tasks: [task("a", { doneAt: "2026-01-01T00:00:00Z" }), task("b"), task("c")],
      edges: [{ from: "a", to: "c" }, { from: "b", to: "c" }],
    });
    expect(updateTask(input, "c", { doneAt: "2026-01-02T00:00:00Z", title: "changed" }))
      .toEqual({ ok: false, error: "task_blocked" });
    expect(input.tasks[2]!.doneAt).toBeNull();
    expect(input.tasks[2]!.title).toBe("c");
    expect(updateTask(input, "c", { title: "changed" }).ok).toBe(true);

    input.tasks[1]!.doneAt = "2026-01-01T00:00:00Z";
    expect(updateTask(input, "c", { doneAt: "2026-01-02T00:00:00Z" }).ok).toBe(true);
  });

  it("patches only the provided fields", () => {
    const input = makeData({ tasks: [task("aaa", { title: "old", progress: "in_progress" })] });
    const result = updateTask(input, "aaa", { title: "new" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.task.title).toBe("new");
    expect(result.task.progress).toBe("in_progress"); // unchanged
  });

  it("returns task_not_found when id missing", () => {
    const result = updateTask(makeData(), "zzz", { title: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("task_not_found");
  });
});

describe("removeTask", () => {
  it("removes task and all incident edges", () => {
    const input = makeData({
      tasks: [task("aaa"), task("bbb"), task("ccc")],
      edges: [{ from: "aaa", to: "bbb" }, { from: "bbb", to: "ccc" }],
    });
    const result = removeTask(input, "bbb");
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.tasks.map((t) => t.id)).toEqual(["aaa", "ccc"]);
    expect(result.data.edges).toEqual([]);
  });
});

describe("addEdge", () => {
  it("adds a valid edge", () => {
    const input = makeData({ tasks: [task("aaa"), task("bbb")] });
    const result = addEdge(input, { from: "aaa", to: "bbb" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.edges).toEqual([{ from: "aaa", to: "bbb" }]);
  });

  it("rejects self-loop", () => {
    const result = addEdge(makeData({ tasks: [task("aaa")] }), { from: "aaa", to: "aaa" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("self_loop");
  });

  it("rejects duplicate edge", () => {
    const input = makeData({
      tasks: [task("aaa"), task("bbb")],
      edges: [{ from: "aaa", to: "bbb" }],
    });
    const result = addEdge(input, { from: "aaa", to: "bbb" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("already_exists");
  });

  it("rejects edge that would create a cycle", () => {
    const input = makeData({
      tasks: [task("a"), task("b"), task("c")],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    });
    const result = addEdge(input, { from: "c", to: "a" });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error === "cycle") {
      expect(result.path.length).toBeGreaterThan(0);
    }
  });

  it("rejects when source task does not exist", () => {
    const input = makeData({ tasks: [task("a")] });
    const result = addEdge(input, { from: "nope", to: "a" });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error === "task_not_found") {
      expect(result.id).toBe("nope");
    }
  });
});

describe("removeEdge", () => {
  it("removes exactly the specified edge", () => {
    const input = makeData({
      tasks: [task("a"), task("b")],
      edges: [{ from: "a", to: "b" }],
    });
    const result = removeEdge(input, { from: "a", to: "b" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.data.edges).toEqual([]);
  });

  it("is strictly directional (does not remove reversed edge)", () => {
    const input = makeData({
      tasks: [task("a"), task("b")],
      edges: [{ from: "a", to: "b" }],
    });
    const result = removeEdge(input, { from: "b", to: "a" });
    expect(result.ok).toBe(false);
  });
});
