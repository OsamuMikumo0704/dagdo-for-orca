import { describe, it, expect } from "bun:test";
import { buildActiveGraph } from "../src/graph/dag";
import { getReadyTasks, topologicalSort } from "../src/graph/topo";
import type { GraphData } from "../src/types";

function makeData(taskIds: string[], edges: [string, string][]): GraphData {
  return {
    version: 1,
    tasks: taskIds.map((id) => ({
      id,
      title: `Task ${id}`,
      progress: "ready" as const,
      createdAt: "2026-01-01T00:00:00Z",
      doneAt: null,
    })),
    edges: edges.map(([from, to]) => ({ from, to })),
  };
}

describe("getReadyTasks", () => {
  it("returns all tasks when no edges", () => {
    const graph = buildActiveGraph(makeData(["a", "b", "c"], []));
    expect(getReadyTasks(graph).map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns only unblocked tasks", () => {
    const graph = buildActiveGraph(makeData(["a", "b", "c"], [["a", "b"], ["b", "c"]]));
    expect(getReadyTasks(graph).map((t) => t.id)).toEqual(["a"]);
  });

  it("sorts by creation date regardless of progress", () => {
    const graph = buildActiveGraph(
      { ...makeData(["a", "b", "c"], []), tasks: makeData(["a", "b", "c"], []).tasks.map((t, i) => ({ ...t, createdAt: ["2026-01-03", "2026-01-01", "2026-01-02"][i]!, progress: i === 0 ? "in_progress" as const : "ready" as const })) }
    );
    expect(getReadyTasks(graph).map((t) => t.id)).toEqual(["b", "c", "a"]);
  });
});

describe("topologicalSort", () => {
  it("returns correct level assignment", () => {
    // a -> b -> c
    const graph = buildActiveGraph(makeData(["a", "b", "c"], [["a", "b"], ["b", "c"]]));
    const { levels } = topologicalSort(graph);
    expect(levels.get("a")).toBe(0);
    expect(levels.get("b")).toBe(1);
    expect(levels.get("c")).toBe(2);
  });

  it("handles diamond DAG levels", () => {
    // a -> b, a -> c, b -> d, c -> d
    const graph = buildActiveGraph(makeData(["a", "b", "c", "d"], [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]]));
    const { order, levels } = topologicalSort(graph);
    expect(order.length).toBe(4);
    expect(levels.get("a")).toBe(0);
    expect(levels.get("d")).toBe(2);
  });

  it("handles empty graph", () => {
    const graph = buildActiveGraph(makeData([], []));
    const { order } = topologicalSort(graph);
    expect(order).toEqual([]);
  });
});
