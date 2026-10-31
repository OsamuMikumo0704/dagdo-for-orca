import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync, openSync, fsyncSync, closeSync } from "fs";
import { join, resolve } from "path";
import { homedir } from "os";
import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import { isProgress } from "./task-state";
import type { GraphData } from "./types";
import * as git from "./git";
import { CliError } from "./cli-error";
import { environment } from "./environment";
import { developmentSample } from "./development-sample";

export function globalDataDir(): string {
  if (process.env.DAGDO_DATA_DIR) return resolve(process.env.DAGDO_DATA_DIR);
  const context = environment();
  return context.development ? context.dataDir : join(process.env.HOME || homedir(), ".dagdo");
}
export function globalDataFile(): string { return join(globalDataDir(), "data.json"); }
/** Written by a running server so the CLI reaches the server that owns this data directory. */
export function serverStateFile(): string { return join(globalDataDir(), ".server.json"); }
const held = new AsyncLocalStorage<string>();
const orcaWrite = new AsyncLocalStorage<boolean>();
export function withOrcaWrite<T>(action: () => T): T { return orcaWrite.run(true, action); }
function protectCreations(previous: ProjectStore, next: ProjectStore): void {
  if (orcaWrite.getStore()) return;
  for (const project of previous.projects) for (const task of project.tasks) {
    if (!task.orcaCreation) continue;
    const current = next.projects.find(p => p.id === project.id)?.tasks.find(t => t.id === task.id);
    if (!current || current.progress !== task.progress || current.doneAt !== task.doneAt || JSON.stringify(current.orcaCreation) !== JSON.stringify(task.orcaCreation)) {
      throw new CliError("creation_pending", "Workspace creation is pending. Reconcile it before deleting this task/project or changing task status.");
    }
  }
}

// Every writer locks BEFORE reading. A dead owner is reclaimed under a separate
// reaper gate so competing processes cannot remove a newly acquired lock.
export async function withGraphLock<T>(action: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const dir = globalDataDir();
  if (held.getStore() === dir) return action();
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, ".data.lock");
  const owner = join(lock, "owner.json");
  const token = randomUUID();
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(lock);
      try { writeFileSync(owner, JSON.stringify({ pid: process.pid, token })); }
      catch (error) { rmdirSync(lock); throw error; }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const gate = lock + ".reap";
    let reaping = false;
    try {
      mkdirSync(gate); reaping = true;
      const previous = JSON.parse(readFileSync(owner, "utf8"));
      if (Number.isInteger(previous.pid) && previous.pid > 0) {
        let dead = false;
        try { process.kill(previous.pid, 0); }
        catch (error) { dead = (error as NodeJS.ErrnoException).code === "ESRCH"; }
        if (dead) { unlinkSync(owner); rmdirSync(lock); }
      }
    } catch (error) {
      if (!["EEXIST", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "") && !(error instanceof SyntaxError)) throw error;
    } finally { if (reaping) rmdirSync(gate); }
    if (Date.now() - started >= timeoutMs) throw new Error("Data lock timed out after " + timeoutMs + "ms: " + lock);
    await new Promise(r => setTimeout(r, 20 + Math.random() * 30));
  }
  try { return await held.run(dir, action); }
  finally {
    const current = JSON.parse(readFileSync(owner, "utf8"));
    if (current.token === token) { unlinkSync(owner); rmdirSync(lock); }
  }
}

export function validateGraph(value: unknown): asserts value is GraphData {
  const data = value as GraphData;
  if (!data || data.version !== 1 || !Array.isArray(data.tasks) || !Array.isArray(data.edges) ||
      data.tasks.some(t => !t || typeof t.id !== "string" || typeof t.title !== "string" || (t.progress !== undefined && !isProgress(t.progress) && (t.progress as string) !== "review")) ||
      data.edges.some(e => !e || typeof e.from !== "string" || typeof e.to !== "string")) throw new Error("Invalid dagdo data structure");
  for (const task of data.tasks) {
    if (task.orcaWorkspace !== undefined) {
      const w = task.orcaWorkspace;
      if (!w || ![w.identityKey, w.id, w.repoId, w.projectId, w.setupId, w.path, w.displayName, w.createdAt].every(v => typeof v === "string" && !!v) || typeof w.branch !== "string") throw new Error("Invalid Orca workspace binding");
    }
    if (task.orcaCreation !== undefined) {
      const c = task.orcaCreation;
      if (!c || task.orcaWorkspace || ![c.requestId, c.setupId, c.repoId, c.name, c.startedAt].every(v => typeof v === "string" && !!v) || !["inherit", "run", "skip"].includes(c.setup) || [c.baseBranch, c.branch].some(v => v !== undefined && typeof v !== "string") || (c.uncertain !== undefined && typeof c.uncertain !== "boolean")) throw new Error("Invalid Orca creation reservation");
    }
  }
}
function normalizeGraph(data: GraphData): GraphData {
  return { version: 1, edges: data.edges, tasks: data.tasks.map(task => {
    const { priority: _oldPriority, tags: _oldTags, ...rest } = task as typeof task & { priority?: unknown; tags?: unknown };
    return { ...rest, progress: (task.progress as string) === "review" ? "in_progress" : task.progress ?? "ready" };
  }) };
}
function readLegacyGraph(): GraphData {
  const file = globalDataFile();
  if (!existsSync(file)) return { version: 1, tasks: [], edges: [] };
  try {
    const data: unknown = JSON.parse(readFileSync(file, "utf8"));
    validateGraph(data); return normalizeGraph(data);
  } catch (error) { throw new Error("Cannot read " + file + ". Restore a backup before updating. " + String(error)); }
}
export async function loadGraph(): Promise<GraphData> {
  if (!existsSync(globalDataFile())) {
    const context = environment();
    if (context.development && resolve(globalDataDir()) === resolve(context.dataDir)) {
      await withGraphLock(async () => {
        if (!existsSync(globalDataFile())) await saveGraph(developmentSample());
      });
    }
  }
  return readGraph();
}
export async function saveGraph(data: GraphData, commitMessage?: string): Promise<void> {
  await withGraphLock(async () => {
    // Refuse to overwrite a damaged existing file, even for direct API callers.
    const store = readStore(); validateGraph(data); JSON.stringify(data);
    const id = selectedProject(store).id;
    store.projects = store.projects.map(p => p.id === id ? { id: p.id, name: p.name, ...normalizeGraph(data) } : p);
    validateStore(store);
    protectCreations(readStore(), store);
    const file = globalDataFile();
    const temp = file + "." + randomUUID() + ".tmp";
    try {
      const fd = openSync(temp, "wx");
      try { writeFileSync(fd, JSON.stringify(store, null, 2) + "\n"); fsyncSync(fd); }
      finally { closeSync(fd); }
      renameSync(temp, file);
    } finally { if (existsSync(temp)) unlinkSync(temp); }
    if (!git.isRepo(globalDataDir())) return;
    try { await git.commit(globalDataDir(), commitMessage ?? "update"); }
    catch (error) { console.error("Warning: auto-commit failed: " + String(error)); }
  });
}

export interface Project extends GraphData { id: string; name: string }
export interface ProjectStore { version: 2; projects: Project[] }
const projectContext = new AsyncLocalStorage<string>();
export function withProject<T>(id: string, action: () => T): T { return projectContext.run(id, action); }
export function readStore(): ProjectStore {
  const file = globalDataFile();
  if (!existsSync(file)) return { version: 2, projects: [{ id: "default", name: "Default", version: 1, tasks: [], edges: [] }] };
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (raw.version === 1) return { version: 2, projects: [{ id: "default", name: "Default", ...readLegacyGraph() }] };
  validateStore(raw);
  return { ...raw, projects: raw.projects.map((p: Project) => ({ ...p, ...normalizeGraph(p) })) };
}
export function validateStore(raw: unknown): asserts raw is ProjectStore {
  const s = raw as ProjectStore;
  if (!s || s.version !== 2 || !Array.isArray(s.projects) || !s.projects.length) throw new Error("Invalid project store");
  const ids = new Set<string>();
  for (const p of s.projects) {
    if (!p || typeof p.id !== "string" || !p.id || ids.has(p.id) || typeof p.name !== "string" || !p.name.trim()) throw new Error("Invalid project");
    ids.add(p.id); validateGraph(p);
    const tasks = new Set(p.tasks.map(t => t.id));
    if (tasks.size !== p.tasks.length || p.edges.some(e => !tasks.has(e.from) || !tasks.has(e.to))) throw new Error("Invalid project graph");
  }
}
export function selectedProject(store: ProjectStore): Project {
  const id = projectContext.getStore();
  if (!id && store.projects.length !== 1) throw new CliError("project_required", "Multiple projects: specify --project <ID>. Run dagdo projects to list IDs.");
  const p = id ? store.projects.find(p => p.id === id) : store.projects[0];
  if (!p) throw new CliError("project_not_found", "Project not found: " + id);
  return p;
}
export function readGraph(): GraphData { return normalizeGraph(selectedProject(readStore())); }
export async function saveStore(store: ProjectStore): Promise<void> {
  await withGraphLock(async () => {
    protectCreations(readStore(), store); validateStore(store);
    store = { ...store, projects: store.projects.map(p => ({ ...p, ...normalizeGraph(p) })) };
    const file = globalDataFile(), temp = file + "." + randomUUID() + ".tmp";
    try {
      const fd = openSync(temp, "wx");
      try { writeFileSync(fd, JSON.stringify(store, null, 2) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, file);
    } finally { if (existsSync(temp)) unlinkSync(temp); }
  });
}
