import { describe, it, expect } from "bun:test";
import { buildActiveGraph, buildFullGraph, effectiveInDegree, wouldCreateCycle } from "../src/graph/dag";
import { computeLayout, renderMermaid } from "../src/graph/render";
import type { GraphData } from "../src/types";

function makeData(taskIds: string[], edges: [string, string][], doneIds: string[] = []): GraphData {
  const doneSet = new Set(doneIds);
  return {
    version: 1,
    tasks: taskIds.map((id) => ({
      id,
      title: `Task ${id}`,
      progress: "ready" as const,
      createdAt: "2026-01-01T00:00:00Z",
      doneAt: doneSet.has(id) ? "2026-01-02T00:00:00Z" : null,
    })),
    edges: edges.map(([from, to]) => ({ from, to })),
  };
}

describe("buildActiveGraph", () => {
  it("excludes done tasks", () => {
    const data = makeData(["a", "b", "c"], [["a", "b"]], ["a"]);
    const graph = buildActiveGraph(data);
    expect(graph.tasks.size).toBe(2);
    expect(graph.tasks.has("a")).toBe(false);
  });

  it("excludes edges involving done tasks", () => {
    const data = makeData(["a", "b"], [["a", "b"]], ["a"]);
    const graph = buildActiveGraph(data);
    expect(graph.inEdges.get("b")!.size).toBe(0);
  });
});

describe("wouldCreateCycle", () => {
  it("detects a self-loop", () => {
    const data = makeData(["a"], []);
    const graph = buildActiveGraph(data);
    expect(wouldCreateCycle(graph, "a", "a")).not.toBeNull();
  });

  it("detects a direct cycle", () => {
    const data = makeData(["a", "b"], [["a", "b"]]);
    const graph = buildActiveGraph(data);
    expect(wouldCreateCycle(graph, "b", "a")).not.toBeNull();
  });

  it("detects an indirect cycle", () => {
    const data = makeData(["a", "b", "c"], [["a", "b"], ["b", "c"]]);
    const graph = buildActiveGraph(data);
    expect(wouldCreateCycle(graph, "c", "a")).not.toBeNull();
  });

  it("allows valid edges", () => {
    const data = makeData(["a", "b", "c"], [["a", "b"]]);
    const graph = buildActiveGraph(data);
    expect(wouldCreateCycle(graph, "b", "c")).toBeNull();
  });

  it("allows diamond DAG (not a cycle)", () => {
    // a -> b, a -> c, b -> d, c -> d
    const data = makeData(["a", "b", "c", "d"], [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]]);
    const graph = buildActiveGraph(data);
    // Adding a -> d is redundant but not a cycle
    expect(wouldCreateCycle(graph, "a", "d")).toBeNull();
  });
});

describe("effectiveInDegree (issue #9)", () => {
  // Scenario from the bug report: A -> B -> C, A marked done.
  // B should be "ready" (effective in-degree = 0) because its only blocker is done.
  it("treats done predecessors as non-blocking on the full graph", () => {
    const data = makeData(["a", "b", "c"], [["a", "b"], ["b", "c"]], ["a"]);
    const graph = buildFullGraph(data);
    expect(effectiveInDegree(graph, "a")).toBe(0); // root
    expect(effectiveInDegree(graph, "b")).toBe(0); // A done ⇒ B unblocked
    expect(effectiveInDegree(graph, "c")).toBe(1); // still blocked by active B
  });

  it("counts multiple unfinished predecessors", () => {
    // a -> c, b -> c with only a done
    const data = makeData(["a", "b", "c"], [["a", "c"], ["b", "c"]], ["a"]);
    const graph = buildFullGraph(data);
    expect(effectiveInDegree(graph, "c")).toBe(1);
  });

  it("computeLayout surfaces effective blocked count", () => {
    const data = makeData(["a", "b", "c"], [["a", "b"], ["b", "c"]], ["a"]);
    const layout = computeLayout(buildFullGraph(data));
    const byId = new Map(layout.nodes.map((n) => [n.task.id, n]));
    expect(byId.get("b")!.blocked).toBe(0);
    expect(byId.get("c")!.blocked).toBe(1);
  });

  it("renderMermaid styles B as ready when its blocker is done", () => {
    const data = makeData(["a", "b", "c"], [["a", "b"], ["b", "c"]], ["a"]);
    const mermaid = renderMermaid(buildFullGraph(data));
    // Green marks Ready nodes
    expect(mermaid).toContain("style b fill:#fbbf24");
    // blocked nodes use white surface
    expect(mermaid).toContain("style c fill:#ffffff");
    // done nodes use muted panel
    expect(mermaid).toContain("style a fill:#f3f4f5");
  });
});
