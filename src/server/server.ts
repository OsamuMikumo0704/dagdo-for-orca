import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { globalDataFile, loadGraph, saveGraph, withGraphLock, readGraph, readStore, saveStore, serverStateFile, withProject } from "../storage";
import { environment } from "../environment";
import {
  addEdge,
  addProject,
  addTask,
  findTask,
  removeEdge,
  removeProject,
  removeTask,
  renameProject,
  updateTask,
  type ProjectResult,
  type TaskPatch,
} from "../graph/mutations";
import { isProgress } from "../task-state";
import type { GraphData } from "../types";
import * as orcaIntegration from "../orca";
import { ProjectHistory } from "./history";

// Bundled (node dist/cli.js): import.meta.url → dist/cli.js, sibling is dist/web/
// Source  (bun run src/cli.ts): import.meta.url → src/server/server.ts, two levels up
const selfDir = dirname(fileURLToPath(import.meta.url));
const UI_HTML_PATH = [
  resolve(selfDir, "web", "index.html"),
  resolve(selfDir, "..", "..", "dist", "web", "index.html"),
].find(existsSync) ?? resolve(selfDir, "web", "index.html");

export interface StartedServer {
  url: string;
  port: number;
  stop: () => Promise<void>;
  closed: Promise<void>;
}

export interface StartOptions {
  preferredPort: number;
}

export async function startServer(opts: StartOptions): Promise<StartedServer> {
  // Initialize worktree sample data once, without requiring a CLI project selection.
  await withProject(readStore().projects[0]!.id, () => loadGraph());
  const clients = new Set<ServerResponse>();
  const histories = new Map<string, ProjectHistory>();
  const syncHistories = () => {
    const store = readStore();
    for (const project of store.projects) {
      const graph: GraphData = { version: 1, tasks: project.tasks, edges: project.edges };
      if (!histories.has(project.id)) histories.set(project.id, new ProjectHistory(graph));
      else histories.get(project.id)!.observe(graph);
    }
    for (const id of histories.keys()) if (!store.projects.some(p => p.id === id)) histories.delete(id);
  };
  syncHistories();
  const broadcast = () => {
    syncHistories();
    broadcastUpdate(clients);
    for (const client of clients) {
      const history = histories.get((client as ServerResponse & { projectId: string }).projectId);
      if (history) sendEvent(client, "history", history.state());
    }
  };
  let stopping = false;
  let stopPromise: Promise<void> | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
  const pending = new Set<Promise<void>>();

  const server = createServer((req, res) => {
    const handle = async () => {
      if (stopping) return sendJson(res, 503, { error: "shutting_down" });
      if (req.url === "/api/shutdown" && req.method === "POST") {
        const host = req.headers.host;
        if (!host || ![`localhost:${port}`, `127.0.0.1:${port}`].includes(host) || req.headers.origin !== `http://${host}`) {
          return sendJson(res, 403, { error: "forbidden" });
        }
        stopping = true;
        res.once("finish", () => { void stop().catch(console.error); });
        sendJson(res, 200, { ok: true });
        return;
      }
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      const historyRoute = /^\/api\/projects\/([^/]+)\/(history(?:\/(undo|redo))?|positions|selection)$/.exec(path);
      if (historyRoute) {
        if (req.method !== "GET" && !sameOrigin(req)) return sendJson(res, 403, { error: "forbidden" });
        return withGraphLock(async () => {
          syncHistories();
          const id = historyRoute[1]!;
          const history = histories.get(id);
          if (!history) return sendJson(res, 404, { error: "project_not_found" });
          if (req.method === "GET" && historyRoute[2] === "history") return sendJson(res, 200, history.state());
          const body = await readJsonBody(req) as any;
          if (!body || typeof body !== "object") return sendJson(res, 400, { error: "invalid_body" });
          if (body.revision !== history.state().revision) { broadcast(); return sendJson(res, 409, { error: "history_conflict", message: "The map changed. Try again.", state: history.state() }); }
          const direction = historyRoute[3];
          if (req.method === "POST" && (direction === "undo" || direction === "redo")) {
            const next = history.target(direction);
            if (!next) return sendJson(res, 409, { error: "history_empty" });
            try { await withProject(id, () => saveGraph(next.graph, direction)); }
            catch (error) { return sendJson(res, 409, { error: "restore_rejected", message: String(error) }); }
            history.commit(direction, next);
          } else if (req.method === "PATCH" && historyRoute[2] === "positions") {
            const positions = body.positions;
            if (!["tree", "mindmap"].includes(body.mode) || !positions || typeof positions !== "object" || Array.isArray(positions) || Object.entries(positions).some(([taskId, p]: [string, any]) => !history.state().graph.tasks.some(t => t.id === taskId) || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return sendJson(res, 400, { error: "invalid_positions" });
            history.place(body.mode, positions);
          } else if (req.method === "DELETE" && historyRoute[2] === "selection") {
            if (!Array.isArray(body.tasks) || !Array.isArray(body.edges) || body.tasks.some((t: unknown) => typeof t !== "string") || body.edges.some((e: any) => !e || typeof e.from !== "string" || typeof e.to !== "string")) return sendJson(res, 400, { error: "invalid_selection" });
            const graph = history.state().graph;
            const next = { ...graph, tasks: graph.tasks.filter(t => !body.tasks.includes(t.id)), edges: graph.edges.filter(e => !body.tasks.includes(e.from) && !body.tasks.includes(e.to) && !body.edges.some((d: any) => d.from === e.from && d.to === e.to)) };
            await withProject(id, () => saveGraph(next, "delete selection"));
          } else return sendJson(res, 405, { error: "method_not_allowed" });
          broadcast(); return sendJson(res, 200, history.state());
        });
      }
      if (path === "/api/orca/projects" && req.method === "GET") return sendJson(res, 200, { projects: await orcaIntegration.projects() });
      if (path === "/api/orca/refs" && req.method === "GET") {
        const query = new URL(req.url!, "http://localhost").searchParams;
        const repo = query.get("repo") || "";
        if (!(await orcaIntegration.projects()).some((p: any) => p.repoId === repo)) return sendJson(res, 400, { error: "invalid_project" });
        return sendJson(res, 200, await orcaIntegration.orca(["repo", "search-refs", "--repo", "id:" + repo, "--query", query.get("q") || "", "--limit", "30"]));
      }
      if (path === "/api/orca/start" && req.method === "POST") {
        if (!sameOrigin(req)) return sendJson(res, 403, { error: "forbidden" });
        return sendJson(res, 200, await orcaIntegration.orca(["open"]));
      }
      const workspaceRoute = /^\/api\/projects\/([^/]+)\/tasks\/([^/]+)\/workspace(?:\/(open|reconcile))?$/.exec(path);
      if (workspaceRoute) {
        const [, projectId, taskId, action] = workspaceRoute;
        if (req.method === "GET" && !action) return sendJson(res, 200, await orcaIntegration.workspaceState(projectId!, taskId!));
        if (!sameOrigin(req)) return sendJson(res, 403, { error: "forbidden" });
        let result;
        if (req.method === "POST" && action === "open") result = await orcaIntegration.openWorkspace(projectId!, taskId!);
        else if (req.method === "POST" && action === "reconcile") result = await orcaIntegration.reconcile(projectId!, taskId!, await readJsonBody(req));
        else if (req.method === "POST" && !action) result = { task: await orcaIntegration.createWorkspace(projectId!, taskId!, await readJsonBody(req)) };
        else if (req.method === "DELETE" && !action) result = await orcaIntegration.unlinkWorkspace(projectId!, taskId!);
        else return sendJson(res, 405, { error: "method_not_allowed" });
        broadcast(); return sendJson(res, 200, result);
      }
      if (path === "/api/projects" || /^\/api\/projects\/[^/]+$/.test(path)) {
        const store = readStore();
        const id = path.split("/")[3];
        if (req.method === "GET" && !id) return sendJson(res, 200, { projects: store.projects.map(({id,name,tasks}) => ({id,name,taskCount:tasks.length})) });
        if (id && !store.projects.some(p => p.id === id)) return sendJson(res, 404, { error: "project_not_found" });
        let result: ProjectResult;
        if (req.method === "DELETE" && id) result = removeProject(store, id);
        else if ((req.method === "POST" && !id) || (req.method === "PATCH" && id)) {
          const body = await readJsonBody(req) as {name?:unknown} | null;
          const name = typeof body?.name === "string" ? body.name : "";
          result = id ? renameProject(store, id, name) : addProject(store, name);
        } else return sendJson(res,405,{error:"method_not_allowed"});
        if (!result.ok) return sendJson(res, result.error === "invalid_name" ? 400 : 409, {error:result.error});
        await saveStore(result.store); broadcast();
        return sendJson(res,200,{project: result.project});
      }
      const scoped = /^\/api\/projects\/([^/]+)\/(graph|events|tasks(?:\/[^/]+)?|edges)$/.exec(path);
      if (scoped) {
        const id = scoped[1]!;
        if (!readStore().projects.some(p => p.id === id)) return sendJson(res,404,{error:"project_not_found"});
        (res as ServerResponse & {projectId?:string}).projectId = id;
        req.url = "/api/" + scoped[2];
        await withProject(id, () => handleRequest(req,res,clients,(placement) => {
          syncHistories();
          if (placement) histories.get(id)!.initialPosition(placement.id, placement.mode, placement.position);
          broadcast();
        }));
        if (scoped[2] === "events") sendEvent(res, "history", histories.get(id)!.state());
        return;
      }
      if (path.startsWith("/api/")) return sendJson(res,404,{error:"not_found"});
      await handleRequest(req, res, clients, broadcast);
    };
    const external = /\/workspace(?:\/|$)|^\/api\/orca\//.test(new URL(req.url ?? "/", "http://localhost").pathname);
    const work = (req.method === "GET" || external ? handle() : withGraphLock(handle)).catch((err) => {
      if (err instanceof orcaIntegration.OrcaError) return sendJson(res, ["task_not_found"].includes(err.code) ? 404 : 409, { error: err.code, message: err.message });
      sendJson(res, 500, { error: "internal", message: err instanceof Error ? err.message : String(err) });
    });
    pending.add(work);
    void work.finally(() => pending.delete(work));
  });

  const port = await listenWithRetry(server, opts.preferredPort);
  const url = `http://localhost:${port}`;
  // Lets the CLI reach this server's in-memory history, whichever way it was started.
  const stateFile = serverStateFile();
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ url, pid: process.pid }));

  const stopWatch = startWatcher(() => {
    if (stopping) return;
    const work = withGraphLock(async () => { if (!stopping) broadcast(); }).catch(console.error);
    pending.add(work);
    void work.finally(() => pending.delete(work));
  });

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopPromise = (async () => {
      stopWatch();
      await Promise.all(pending);
      for (const c of clients) {
        try {
          sendEvent(c, "shutdown", {});
          c.end();
        } catch {
          // already closed
        }
      }
      clients.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeIdleConnections();
      });
      rmSync(stateFile, { force: true });
      resolveClosed();
    })();
    return stopPromise;
  };
  return { port, url, stop, closed };
}

function sameOrigin(req: IncomingMessage): boolean {
  const host = req.headers.host;
  return !!host && /^(localhost|127\.0\.0\.1):\d+$/.test(host) && req.headers.origin === `http://${host}`;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  clients: Set<ServerResponse>,
  broadcast: (placement?: { id: string; mode: "tree" | "mindmap"; position: { x: number; y: number } }) => void,
): Promise<void> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  if (method === "GET" && (url === "/" || url === "/index.html")) {
    serveIndex(res);
    return;
  }

  if (method === "GET" && url === "/api/graph") {
    serveGraph(res);
    return;
  }

  if (method === "GET" && url === "/api/events") {
    attachSseClient(res, clients);
    return;
  }

  if (method === "POST" && url === "/api/tasks") {
    await handleCreateTask(req, res, broadcast);
    return;
  }

  if (method === "POST" && url === "/api/edges") {
    await handleCreateEdge(req, res, broadcast);
    return;
  }

  if (method === "DELETE" && url === "/api/edges") {
    await handleDeleteEdge(req, res, broadcast);
    return;
  }

  const taskIdMatch = /^\/api\/tasks\/([0-9a-f]{1,12})$/.exec(url);
  if (taskIdMatch) {
    const id = taskIdMatch[1]!;
    if (method === "PATCH") {
      await handleUpdateTask(req, res, broadcast, id);
      return;
    }
    if (method === "DELETE") {
      await handleDeleteTask(req, res, broadcast, id);
      return;
    }
  }

  if (method === "GET" && url === "/favicon.ico") {
    res.statusCode = 204;
    res.end();
    return;
  }

  res.statusCode = 404;
  res.end("Not found");
}

// ─── writes ───────────────────────────────────────────────────────────

async function handleCreateTask(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: (placement?: { id: string; mode: "tree" | "mindmap"; position: { x: number; y: number } }) => void,
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") return sendJson(res, 400, { error: "invalid_body" });

  const title = (body as Record<string, unknown>).title;
  if (typeof title !== "string" || title.trim().length === 0) {
    return sendJson(res, 400, { error: "invalid_title" });
  }

  const b = body as Record<string, unknown>;
  const placement = b.placement as { mode: "tree" | "mindmap"; x: number; y: number } | undefined;
  if (placement && (!["tree", "mindmap"].includes(placement.mode) || !Number.isFinite(placement.x) || !Number.isFinite(placement.y))) return sendJson(res, 400, { error: "invalid_positions" });
  if ("priority" in b) return sendJson(res, 400, { error: "priority_removed" });
  if ("progress" in b && !isProgress(b.progress)) return sendJson(res, 400, { error: "invalid_progress" });
  const progress = b.progress;
  const args = {
    title: title.trim(),
    progress: isProgress(progress) ? progress : undefined,
  };

  const graph = await loadGraph();

  const { data, task } = addTask(graph, args);
  await saveGraph(data, `add: ${task.title}`);
  broadcast(placement ? { id: task.id, mode: placement.mode, position: { x: placement.x, y: placement.y } } : undefined);
  sendJson(res, 201, { task });
}

async function handleUpdateTask(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: (placement?: { id: string; mode: "tree" | "mindmap"; position: { x: number; y: number } }) => void,
  id: string,
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") return sendJson(res, 400, { error: "invalid_body" });

  const patch: TaskPatch = {};
  const b = body as Record<string, unknown>;
  if (typeof b.title === "string") patch.title = b.title;
  if ("priority" in b) return sendJson(res, 400, { error: "priority_removed" });
  if ("progress" in b && !isProgress(b.progress)) return sendJson(res, 400, { error: "invalid_progress" });
  if (isProgress(b.progress)) patch.progress = b.progress;
  if (b.doneAt === null || typeof b.doneAt === "string") patch.doneAt = b.doneAt;
  if (b.notes === null || typeof b.notes === "string") patch.notes = b.notes;
  if ("clearDependencies" in b && typeof b.clearDependencies !== "boolean") return sendJson(res, 400, { error: "invalid_input" });
  if (b.clearDependencies === true) patch.clearDependencies = true;
  const placement = b.placement as { mode: "tree" | "mindmap"; x: number; y: number } | undefined;
  if ("placement" in b && (!placement || !["tree", "mindmap"].includes(placement.mode) || !Number.isFinite(placement.x) || !Number.isFinite(placement.y))) return sendJson(res, 400, { error: "invalid_positions" });
  if (placement && !sameOrigin(req)) return sendJson(res, 403, { error: "forbidden" });

  if (Object.keys(patch).length === 0) return sendJson(res, 400, { error: "empty_patch" });

  const graph = await loadGraph();
  if (placement && (patch.progress !== "ready" || !graph.tasks.some(t => t.id === id && t.progress === "backlog" && t.doneAt == null))) return sendJson(res, 409, { error: "backlog_changed", message: "The task is no longer in Backlog. Refresh and try again." });
  const result = updateTask(graph, id, patch);
  if (!result.ok) {
    if (["task_backlog", "backlog_dependencies", "invalid_input"].includes(result.error)) return sendJson(res, 409, { error: result.error });
    if (result.error === "task_blocked") {
      return sendJson(res, 409, { error: result.error });
    }
    if (result.error === "note_too_long") {
      return sendJson(res, 400, { error: result.error, limit: result.limit });
    }
    return sendJson(res, 404, { error: result.error });
  }

  await saveGraph(result.data, `edit: ${result.task.title}`);
  broadcast(placement ? { id, mode: placement.mode, position: { x: placement.x, y: placement.y } } : undefined);
  sendJson(res, 200, { task: result.task });
}

async function handleDeleteTask(
  _req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
  id: string,
): Promise<void> {
  const graph = await loadGraph();
  const result = removeTask(graph, id);
  if (!result.ok) return sendJson(res, 404, { error: result.error });

  await saveGraph(result.data, `rm: ${result.removedTask.title}`);
  broadcast();
  res.statusCode = 204;
  res.end();
}

async function handleCreateEdge(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") return sendJson(res, 400, { error: "invalid_body" });
  const b = body as Record<string, unknown>;
  if (typeof b.from !== "string" || typeof b.to !== "string") {
    return sendJson(res, 400, { error: "invalid_edge" });
  }

  const graph = await loadGraph();
  const result = addEdge(graph, { from: b.from, to: b.to });
  if (!result.ok) {
    if (result.error === "task_not_found") {
      return sendJson(res, 404, { error: "task_not_found", id: result.id });
    }
    if (result.error === "cycle") {
      return sendJson(res, 409, { error: "cycle", path: result.path });
    }
    return sendJson(res, 409, { error: result.error });
  }

  const fromTitle = findTask(result.data, b.from)?.title ?? b.from;
  const toTitle = findTask(result.data, b.to)?.title ?? b.to;
  await saveGraph(result.data, `link: ${fromTitle} -> ${toTitle}`);
  broadcast();
  sendJson(res, 201, { ok: true });
}

async function handleDeleteEdge(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast: () => void,
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") return sendJson(res, 400, { error: "invalid_body" });
  const b = body as Record<string, unknown>;
  if (typeof b.from !== "string" || typeof b.to !== "string") {
    return sendJson(res, 400, { error: "invalid_edge" });
  }

  const graph = await loadGraph();
  const fromTitle = findTask(graph, b.from)?.title ?? b.from;
  const toTitle = findTask(graph, b.to)?.title ?? b.to;
  const result = removeEdge(graph, { from: b.from, to: b.to });
  if (!result.ok) return sendJson(res, 404, { error: result.error });

  await saveGraph(result.data, `unlink: ${fromTitle} x ${toTitle}`);
  broadcast();
  res.statusCode = 204;
  res.end();
}

// ─── tab writes ──────────────────────────────────────────────────────

function serveIndex(res: ServerResponse): void {
  if (!existsSync(UI_HTML_PATH)) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(
      "dagdo UI bundle not found.\n\n" +
        "If you installed from source, run:\n" +
        "  (cd web && bun install && bun run build)\n\n" +
        `Expected: ${UI_HTML_PATH}`,
    );
    return;
  }
  const html = readFileSync(UI_HTML_PATH);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(html);
}

function serveGraph(res: ServerResponse): void {
  const graph = readGraphSafely();
  sendJson(res, 200, graph);
}

function attachSseClient(res: ServerResponse, clients: Set<ServerResponse>): void {
  const initial = readGraphSafely();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  clients.add(res);
  sendEvent(res, "update", initial);

  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  res.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
}

function broadcastUpdate(clients: Set<ServerResponse>): void {
  const store = readStore();
  for (const c of clients) {
    sendEvent(c,"projects",{projects:store.projects.map(({id,name,tasks}) => ({id,name,taskCount:tasks.length}))});
    const project = store.projects.find(p => p.id === (c as ServerResponse & {projectId?:string}).projectId);
    if (project) sendEvent(c,"update",project);
    else { sendEvent(c,"project_deleted",{}); c.end(); }
  }
}

function sendEvent(res: ServerResponse, event: string, data: unknown): void {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch {
    // client gone; next poll will remove it via 'close'
  }
}

function readGraphSafely(): GraphData { return readGraph(); }

function startWatcher(onChange: () => void): () => void {
  let last = currentMtime();
  const iv = setInterval(() => {
    const now = currentMtime();
    if (now !== last) {
      last = now;
      try { onChange(); } catch (error) { console.error(String(error)); }
    }
  }, 500);
  return () => clearInterval(iv);
}

function currentMtime(): number {
  const file = globalDataFile();
  if (!existsSync(file)) return 0;
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

async function listenWithRetry(server: Server, startPort: number): Promise<number> {
  if (startPort === 0) {
    await listenOn(server, 0);
    const addr = server.address();
    if (addr && typeof addr === "object") return addr.port;
    throw new Error("Failed to resolve bound port");
  }

  const MAX_ATTEMPTS = environment().development ? Math.min(200, 65536 - startPort) : process.env.DAGDO_LOCAL_MODE === "1" ? 1 : 20;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const port = startPort + i;
    try {
      await listenOn(server, port);
      return port;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  throw new Error(
    `Could not bind a port in range ${startPort}..${startPort + MAX_ATTEMPTS - 1}`,
  );
}

function listenOn(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off("listening", onListen);
      reject(err);
    };
    const onListen = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListen);
    server.listen(port, "127.0.0.1");
  });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// ─── reads & streaming ───────────────────────────────────────────────
