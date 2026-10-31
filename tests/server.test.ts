import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { GraphData } from "../src/types";

// Local dev machines may have HTTP_PROXY set, which Bun's fetch honors and
// which will 502 against our loopback server. Mask proxies for this suite.
delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;
process.env.NO_PROXY = "localhost,127.0.0.1";
process.env.no_proxy = "localhost,127.0.0.1";

describe("server", () => {
  let testHome: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    testHome = join(tmpdir(), `dagdo-server-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(testHome, ".dagdo"), { recursive: true });
    originalHome = process.env.DAGDO_DATA_DIR;
    process.env.DAGDO_DATA_DIR = join(testHome, ".dagdo");
  });

  afterEach(() => {
    if (originalHome !== undefined) process.env.DAGDO_DATA_DIR = originalHome;
    else delete process.env.DAGDO_DATA_DIR;
    rmSync(testHome, { recursive: true, force: true });
  });

  it("requires a same-origin POST and notifies all streams before stopping", async () => {
    const { startServer } = await import("../src/server/server");
    const srv = await startServer({ preferredPort: 0 });
    try {
      for (const origin of [undefined, "https://example.com", "http://localhost:1"]) {
        const res = await fetch(`${srv.url}/api/shutdown`, {
          method: "POST", headers: origin ? { Origin: origin } : {},
        });
        expect(res.status).toBe(403);
      }
      expect((await fetch(`${srv.url}/api/shutdown`)).status).toBe(404);
      const responses = await Promise.all([1, 2].map(() => fetch(`${srv.url}/api/projects/default/events`)));
      const streams = responses.map(response => response.text());
      const before = await (await fetch(`${srv.url}/api/projects/default/graph`)).json() as GraphData;
      const res = await fetch(`${srv.url}/api/shutdown`, { method: "POST", headers: { Origin: srv.url } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      for (const stream of streams) expect(await stream).toContain("event: shutdown");
      await srv.closed;
      await Promise.all([srv.stop(), srv.stop()]);
      const { readGraph } = await import("../src/storage");
      expect(readGraph()).toEqual(before);
      await expect(fetch(`${srv.url}/api/projects/default/graph`)).rejects.toThrow();
    } finally {
      await srv.stop();
    }
  });

  it("exits the UI process after browser shutdown", async () => {
    const { startServer } = await import("../src/server/server");
    const probe = await startServer({ preferredPort: 0 });
    const port = probe.port;
    await probe.stop();
    const child = Bun.spawn([process.execPath, "run", "src/cli.ts", "ui", "--port", String(port), "--no-open"], {
      env: { ...process.env, DAGDO_LOCAL_MODE: "1" }, stdout: "pipe", stderr: "pipe",
    });
    try {
      const reader = child.stdout.getReader();
      let output = "";
      let url: string | undefined;
      while (!url) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error(`Server exited: ${output} ${await new Response(child.stderr).text()}`);
        output += new TextDecoder().decode(chunk.value);
        url = /running at (http:\/\/localhost:\d+)/.exec(output)?.[1];
      }
      reader.releaseLock();
      expect((await fetch(`${url}/api/shutdown`, { method: "POST", headers: { Origin: url } })).status).toBe(200);
      expect(await child.exited).toBe(0);
    } finally {
      child.kill();
      await child.exited;
    }
  });

  it("preserves accepted writes when shutdown races with updates", async () => {
    const { startServer } = await import("../src/server/server");
    const srv = await startServer({ preferredPort: 0 });
    try {
      const writes = Array.from({ length: 8 }, (_, n) => fetch(`${srv.url}/api/projects/default/tasks`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: `task ${n}` }),
      }));
      const shutdown = fetch(`${srv.url}/api/shutdown`, { method: "POST", headers: { Origin: srv.url } });
      // Connections that have not reached the server can close during shutdown.
      const results = await Promise.allSettled(writes);
      const responses = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      expect((await shutdown).status).toBe(200);
      await srv.closed;
      for (const response of responses) expect([201, 503]).toContain(response.status);
      const { readGraph } = await import("../src/storage");
      expect(readGraph().tasks.length).toBe(responses.filter(r => r.status === 201).length);
    } finally { await srv.stop(); }
  });

  it("serves the current graph at /api/projects/default/graph", async () => {
    const seed: GraphData = {
      version: 1,
      tasks: [
        {
          id: "abcdef",
          title: "seed",
          progress: "ready",
          createdAt: "2026-01-01T00:00:00Z",
          doneAt: null,
        },
      ],
      edges: [],
    };
    writeFileSync(join(testHome, ".dagdo", "data.json"), JSON.stringify(seed));

    // Import inside the test so the module re-reads HOME each time via the
    // storage helper rather than caching from an earlier test's HOME.
    const { startServer } = await import(`../src/server/server?t=${Date.now()}`);
    const srv = await startServer({ preferredPort: 0 });

    try {
      const res = await fetch(`${srv.url}/api/projects/default/graph`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as GraphData;
      expect(body.tasks.length).toBe(1);
      expect(body.tasks[0]!.title).toBe("seed");
    } finally {
      await srv.stop();
    }
  });

  it("returns an empty graph when data.json is absent", async () => {
    const { startServer } = await import(`../src/server/server?t=${Date.now()}`);
    const srv = await startServer({ preferredPort: 0 });

    try {
      const res = await fetch(`${srv.url}/api/projects/default/graph`);
      const body = (await res.json()) as GraphData;
      expect(body.tasks).toEqual([]);
      expect(body.edges).toEqual([]);
    } finally {
      await srv.stop();
    }
  });

  it("picks a different port when preferredPort is in use", async () => {
    const { startServer } = await import(`../src/server/server?t=${Date.now()}`);
    const first = await startServer({ preferredPort: 0 });

    try {
      const second = await startServer({ preferredPort: first.port });
      try {
        expect(second.port).toBeGreaterThan(first.port);
      } finally {
        await second.stop();
      }
    } finally {
      await first.stop();
    }
  });

  it("responds 204 to /favicon.ico", async () => {
    const { startServer } = await import(`../src/server/server?t=${Date.now()}`);
    const srv = await startServer({ preferredPort: 0 });

    try {
      const res = await fetch(`${srv.url}/favicon.ico`);
      expect(res.status).toBe(204);
    } finally {
      await srv.stop();
    }
  });

  it("POST /api/projects/default/tasks creates a task and persists it", async () => {
    const { startServer } = await import(`../src/server/server?t=${Date.now()}`);
    const srv = await startServer({ preferredPort: 0 });

    try {
      const create = await fetch(`${srv.url}/api/projects/default/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "new task", progress: "in_progress" }),
      });
      expect(create.status).toBe(201);
      const created = (await create.json()) as { task: { id: string; title: string; progress: string } };
      expect(created.task.title).toBe("new task");
      expect(created.task.progress).toBe("in_progress");

      // Read back via /api/projects/default/graph to confirm persistence
      const graphRes = await fetch(`${srv.url}/api/projects/default/graph`);
      const graph = (await graphRes.json()) as GraphData;
      expect(graph.tasks.map((t) => t.id)).toContain(created.task.id);
    } finally {
      await srv.stop();
    }
  });

  it("PATCH /api/projects/default/tasks/:id updates a task", async () => {
    const seed: GraphData = {
      version: 1,
      tasks: [
        { id: "abcdef", title: "old", progress: "ready", createdAt: "2026-01-01T00:00:00Z", doneAt: null },
      ],
      edges: [],
    };
    writeFileSync(join(testHome, ".dagdo", "data.json"), JSON.stringify(seed));

    const { startServer } = await import(`../src/server/server?t=${Date.now()}`);
    const srv = await startServer({ preferredPort: 0 });

    try {
      const res = await fetch(`${srv.url}/api/projects/default/tasks/abcdef`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "renamed" }),
      });
      expect(res.status).toBe(200);
      const payload = (await res.json()) as { task: { title: string } };
      expect(payload.task.title).toBe("renamed");
    } finally {
      await srv.stop();
    }
  });

  it("DELETE /api/projects/default/tasks/:id removes the task and its edges", async () => {
    const seed: GraphData = {
      version: 1,
      tasks: [
        { id: "aaaaaa", title: "a", progress: "ready", createdAt: "2026-01-01T00:00:00Z", doneAt: null },
        { id: "bbbbbb", title: "b", progress: "ready", createdAt: "2026-01-01T00:00:00Z", doneAt: null },
      ],
      edges: [{ from: "aaaaaa", to: "bbbbbb" }],
    };
    writeFileSync(join(testHome, ".dagdo", "data.json"), JSON.stringify(seed));

    const { startServer } = await import(`../src/server/server?t=${Date.now()}`);
    const srv = await startServer({ preferredPort: 0 });

    try {
      const res = await fetch(`${srv.url}/api/projects/default/tasks/aaaaaa`, { method: "DELETE" });
      expect(res.status).toBe(204);

      const graph = (await (await fetch(`${srv.url}/api/projects/default/graph`)).json()) as GraphData;
      expect(graph.tasks.map((t) => t.id)).toEqual(["bbbbbb"]);
      expect(graph.edges).toEqual([]);
    } finally {
      await srv.stop();
    }
  });

  it("POST /api/projects/default/edges returns 409 on cycle", async () => {
    const seed: GraphData = {
      version: 1,
      tasks: ["a", "b", "c"].map((id) => ({
        id,
        title: id,
        progress: "ready" as const,
        createdAt: "2026-01-01T00:00:00Z",
        doneAt: null,
      })),
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };
    writeFileSync(join(testHome, ".dagdo", "data.json"), JSON.stringify(seed));

    const { startServer } = await import(`../src/server/server?t=${Date.now()}`);
    const srv = await startServer({ preferredPort: 0 });

    try {
      const res = await fetch(`${srv.url}/api/projects/default/edges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "c", to: "a" }),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string; path?: string[] };
      expect(body.error).toBe("cycle");
      expect(body.path).toBeDefined();
    } finally {
      await srv.stop();
    }
  });

  it("DELETE /api/projects/default/edges removes the specified edge", async () => {
    const seed: GraphData = {
      version: 1,
      tasks: ["a", "b"].map((id) => ({
        id,
        title: id,
        progress: "ready" as const,
        createdAt: "2026-01-01T00:00:00Z",
        doneAt: null,
      })),
      edges: [{ from: "a", to: "b" }],
    };
    writeFileSync(join(testHome, ".dagdo", "data.json"), JSON.stringify(seed));

    const { startServer } = await import(`../src/server/server?t=${Date.now()}`);
    const srv = await startServer({ preferredPort: 0 });

    try {
      const res = await fetch(`${srv.url}/api/projects/default/edges`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "a", to: "b" }),
      });
      expect(res.status).toBe(204);

      const graph = (await (await fetch(`${srv.url}/api/projects/default/graph`)).json()) as GraphData;
      expect(graph.edges).toEqual([]);
    } finally {
      await srv.stop();
    }
  });
});
