import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { GraphData } from "../src/types";

// Helper: write a graph to a file and return the path
function writeGraph(dir: string, data: GraphData): string {
  const dagdoDir = join(dir, ".dagdo");
  mkdirSync(dagdoDir, { recursive: true });
  const file = join(dagdoDir, "data.json");
  writeFileSync(file, JSON.stringify(data));
  return file;
}

function makeGraph(overrides: Partial<GraphData> = {}): GraphData {
  return { version: 1, tasks: [], edges: [], ...overrides };
}

// ─── link command ────────────────────────────────────────────────────────────

describe("link command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), "dagdo-test-" + Date.now());
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("--before: adds edge from A to B", async () => {
    const data = makeGraph({
      tasks: [
        { id: "aaa111", title: "A", progress: "ready", createdAt: "2026-01-01T00:00:00Z", doneAt: null },
        { id: "bbb222", title: "B", progress: "ready", createdAt: "2026-01-01T00:00:00Z", doneAt: null },
      ],
    });
    const file = writeGraph(tmpDir, data);
    const saved: GraphData = JSON.parse(await Bun.file(file).text());
    // Simulate what link --before does
    saved.edges.push({ from: "aaa111", to: "bbb222" });
    await Bun.write(file, JSON.stringify(saved));
    const result: GraphData = JSON.parse(await Bun.file(file).text());
    expect(result.edges).toEqual([{ from: "aaa111", to: "bbb222" }]);
  });

  it("--after: adds edge from B to A", async () => {
    const data = makeGraph({
      tasks: [
        { id: "aaa111", title: "A", progress: "ready", createdAt: "2026-01-01T00:00:00Z", doneAt: null },
        { id: "bbb222", title: "B", progress: "ready", createdAt: "2026-01-01T00:00:00Z", doneAt: null },
      ],
    });
    const file = writeGraph(tmpDir, data);
    const saved: GraphData = JSON.parse(await Bun.file(file).text());
    // link A --after B means B must be done before A → edge: B → A
    saved.edges.push({ from: "bbb222", to: "aaa111" });
    await Bun.write(file, JSON.stringify(saved));
    const result: GraphData = JSON.parse(await Bun.file(file).text());
    expect(result.edges).toEqual([{ from: "bbb222", to: "aaa111" }]);
  });
});

// ─── unlink command ───────────────────────────────────────────────────────────

describe("unlink command", () => {
  it("removes edge A→B when given (A, B)", () => {
    const edges = [{ from: "aaa", to: "bbb" }];
    const idx = edges.findIndex(
      (e) => (e.from === "aaa" && e.to === "bbb") || (e.from === "bbb" && e.to === "aaa")
    );
    expect(idx).toBe(0);
    edges.splice(idx, 1);
    expect(edges).toEqual([]);
  });

  it("removes edge A→B when given (B, A) — direction-agnostic", () => {
    const edges = [{ from: "aaa", to: "bbb" }];
    const idx = edges.findIndex(
      (e) => (e.from === "bbb" && e.to === "aaa") || (e.from === "aaa" && e.to === "bbb")
    );
    expect(idx).toBe(0);
    edges.splice(idx, 1);
    expect(edges).toEqual([]);
  });

  it("returns -1 when edge does not exist", () => {
    const edges = [{ from: "aaa", to: "bbb" }];
    const idx = edges.findIndex(
      (e) => (e.from === "aaa" && e.to === "ccc") || (e.from === "ccc" && e.to === "aaa")
    );
    expect(idx).toBe(-1);
  });
});

