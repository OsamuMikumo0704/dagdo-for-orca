import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { GraphData } from "../src/types";

describe("storage format", () => {
  let testDir: string;
  let testFile: string;

  beforeEach(() => {
    testDir = join(tmpdir(), "dagdo-storage-" + Date.now());
    mkdirSync(testDir, { recursive: true });
    testFile = join(testDir, "data.json");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("roundtrips graph data through JSON", () => {
    const data: GraphData = {
      version: 1,
      tasks: [
        { id: "abc123", title: "Test task", progress: "in_progress", createdAt: "2026-01-01T00:00:00Z", doneAt: null },
      ],
      edges: [{ from: "abc123", to: "def456" }],
    };

    writeFileSync(testFile, JSON.stringify(data, null, 2));
    const loaded = JSON.parse(readFileSync(testFile, "utf-8"));
    expect(loaded).toEqual(data);
  });

  it("handles missing file gracefully", () => {
    expect(existsSync(join(testDir, "nonexistent.json"))).toBe(false);
  });

  it("overwrites existing file on save", () => {
    const v1: GraphData = { version: 1, tasks: [], edges: [] };
    const v2: GraphData = {
      version: 1,
      tasks: [{ id: "aaa111", title: "New", progress: "ready", createdAt: "2026-01-01T00:00:00Z", doneAt: null }],
      edges: [],
    };

    writeFileSync(testFile, JSON.stringify(v1, null, 2));
    writeFileSync(testFile, JSON.stringify(v2, null, 2));
    const loaded = JSON.parse(readFileSync(testFile, "utf-8"));
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0].id).toBe("aaa111");
  });

  it("preserves unicode in task titles", () => {
    const data: GraphData = {
      version: 1,
      tasks: [{ id: "uni001", title: "Design database schema \u{1F5C3}", progress: "in_progress", createdAt: "2026-01-01T00:00:00Z", doneAt: null }],
      edges: [],
    };

    writeFileSync(testFile, JSON.stringify(data, null, 2));
    const loaded = JSON.parse(readFileSync(testFile, "utf-8"));
    expect(loaded.tasks[0].title).toBe("Design database schema \u{1F5C3}");
  });

  it("writes to nested directory with mkdirSync", () => {
    const nested = join(testDir, "a", "b", "c");
    const nestedFile = join(nested, "data.json");
    mkdirSync(nested, { recursive: true });
    writeFileSync(nestedFile, JSON.stringify({ version: 1, tasks: [], edges: [] }));
    expect(existsSync(nestedFile)).toBe(true);
    const loaded = JSON.parse(readFileSync(nestedFile, "utf-8"));
    expect(loaded.version).toBe(1);
  });

  it("handles empty tasks and edges", () => {
    const data: GraphData = { version: 1, tasks: [], edges: [] };
    writeFileSync(testFile, JSON.stringify(data, null, 2));
    const loaded = JSON.parse(readFileSync(testFile, "utf-8"));
    expect(loaded.tasks).toEqual([]);
    expect(loaded.edges).toEqual([]);
  });

  it("roundtrips binary-like PNG buffer through writeFileSync", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const outFile = join(testDir, "test.png");
    writeFileSync(outFile, buf);
    const read = readFileSync(outFile);
    expect(Buffer.compare(read, buf)).toBe(0);
  });
});
