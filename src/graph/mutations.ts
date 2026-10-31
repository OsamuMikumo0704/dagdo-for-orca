import { generateId } from "../ids";
import { computeTaskStates } from "../task-state";
import { wouldCreateCycle, buildActiveGraph } from "./dag";
import type { Edge, GraphData, TaskProgress, Task } from "../types";
import type { Project, ProjectStore } from "../storage";

/**
 * Pure data operations over `GraphData`. Each function returns a new
 * `GraphData` rather than mutating in place, and encodes domain errors
 * in a discriminated-union result rather than throwing. Both the CLI
 * and the HTTP server call through these so the two paths stay in lock-step.
 *
 * Callers are responsible for: ID prefix resolution (for CLI ergonomics),
 * persistence (`saveGraph`), and generating commit messages — these are
 * concerns of the caller's transport, not the data model.
 */

export interface AddTaskArgs {
  title: string;
  progress?: TaskProgress;
}

export function addTask(data: GraphData, args: AddTaskArgs): { data: GraphData; task: Task } {
  const task: Task = {
    id: generateId(),
    title: args.title,
    progress: args.progress ?? "ready",
    createdAt: new Date().toISOString(),
    doneAt: null,
  };
  const next: GraphData = { ...data, tasks: [...data.tasks, task] };
  return { data: next, task };
}

/**
 * Soft ceiling on `notes`. Counted in JS string length (UTF-16 code units),
 * not bytes — predictable for users regardless of script. 2000 chars is about
 * 6 KB of pure CJK or 2 KB of ASCII, enough for acceptance criteria + a link
 * or two without letting a pathological paste balloon `data.json`.
 */
export const NOTES_MAX_CHARS = 2000;

export interface TaskPatch {
  title?: string;
  progress?: TaskProgress;
  doneAt?: string | null;
  /** `null` clears the notes field; a string replaces it. */
  notes?: string | null;
  clearDependencies?: boolean;
}

export type UpdateTaskResult =
  | { ok: true; data: GraphData; task: Task }
  | { ok: false; error: "task_not_found" }
  | { ok: false; error: "task_blocked" | "task_backlog" | "backlog_dependencies" | "invalid_input" }
  | { ok: false; error: "note_too_long"; limit: number };

export function updateTask(data: GraphData, id: string, patch: TaskPatch): UpdateTaskResult {
  const idx = data.tasks.findIndex((t) => t.id === id);
  if (idx < 0) return { ok: false, error: "task_not_found" };

  if (typeof patch.notes === "string" && patch.notes.length > NOTES_MAX_CHARS) {
    return { ok: false, error: "note_too_long", limit: NOTES_MAX_CHARS };
  }

  const existing = data.tasks[idx]!;
  const progress = patch.progress ?? existing.progress;
  const doneAt = patch.doneAt === undefined ? existing.doneAt : patch.doneAt;
  if (progress === "backlog" && doneAt != null) return { ok: false, error: "task_backlog" };
  if (patch.clearDependencies && patch.progress !== "backlog") return { ok: false, error: "invalid_input" };
  if (patch.progress === "backlog" && data.edges.some(e => e.from === id || e.to === id) && !patch.clearDependencies) return { ok: false, error: "backlog_dependencies" };
  if (patch.doneAt != null && computeTaskStates(data.tasks, data.edges).get(id) === "blocked") {
    return { ok: false, error: "task_blocked" };
  }
  const updated: Task = {
    ...existing,
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
    ...(patch.doneAt !== undefined ? { doneAt: patch.doneAt } : {}),
    ...applyNotesPatch(patch.notes),
  };
  const tasks = data.tasks.slice();
  tasks[idx] = updated;
  return { ok: true, data: { ...data, tasks, edges: patch.progress === "backlog" ? data.edges.filter(e => e.from !== id && e.to !== id) : data.edges }, task: updated };
}

// `null` (and empty string) means "drop the field entirely" so serialized
// `data.json` doesn't grow a `"notes": ""` line for every task that's ever
// had its notes cleared. A string with content sets it.
function applyNotesPatch(notes: string | null | undefined): Partial<Task> {
  if (notes === undefined) return {};
  if (notes === null || notes === "") return { notes: undefined };
  return { notes };
}

export type RemoveTaskResult =
  | { ok: true; data: GraphData; removedTask: Task }
  | { ok: false; error: "task_not_found" };

/**
 * Remove a task and every edge incident to it. Unlike the CLI's `rm`, this
 * never refuses based on "has dependents" — the caller enforces that policy
 * if it wants to (e.g. CLI requires `--force` when blocking others; UI
 * deletion is terminal).
 */
export function removeTask(data: GraphData, id: string): RemoveTaskResult {
  const task = data.tasks.find((t) => t.id === id);
  if (!task) return { ok: false, error: "task_not_found" };
  const cleaned: GraphData = {
    ...data,
    tasks: data.tasks.filter((t) => t.id !== id),
    edges: data.edges.filter((e) => e.from !== id && e.to !== id),
  };
  return { ok: true, data: cleaned, removedTask: task };
}

export type AddEdgeResult =
  | { ok: true; data: GraphData }
  | { ok: false; error: "task_backlog" }
  | { ok: false; error: "self_loop" }
  | { ok: false; error: "task_not_found"; id: string }
  | { ok: false; error: "already_exists" }
  | { ok: false; error: "cycle"; path: string[] };

export function addEdge(data: GraphData, args: { from: string; to: string }): AddEdgeResult {
  const { from, to } = args;
  if (from === to) return { ok: false, error: "self_loop" };

  const hasFrom = data.tasks.some((t) => t.id === from);
  if (!hasFrom) return { ok: false, error: "task_not_found", id: from };
  const hasTo = data.tasks.some((t) => t.id === to);
  if (!hasTo) return { ok: false, error: "task_not_found", id: to };

  if (data.tasks.some(t => (t.id === from || t.id === to) && t.progress === "backlog")) return { ok: false, error: "task_backlog" };
  if (data.edges.some((e) => e.from === from && e.to === to)) {
    return { ok: false, error: "already_exists" };
  }

  // Cycle detection runs on the active-only graph, matching the CLI's `link`
  // semantics: a cycle through a done task can't actually re-block anyone,
  // and the edge will be rendered as a harmless dashed line.
  const active = buildActiveGraph(data);
  const cycle = wouldCreateCycle(active, from, to);
  if (cycle) return { ok: false, error: "cycle", path: cycle };

  const edge: Edge = { from, to };
  return { ok: true, data: { ...data, edges: [...data.edges, edge] } };
}

export type RemoveEdgeResult =
  | { ok: true; data: GraphData }
  | { ok: false; error: "not_found" };

export function removeEdge(data: GraphData, args: { from: string; to: string }): RemoveEdgeResult {
  const { from, to } = args;
  const idx = data.edges.findIndex((e) => e.from === from && e.to === to);
  if (idx < 0) return { ok: false, error: "not_found" };
  const edges = data.edges.slice();
  edges.splice(idx, 1);
  return { ok: true, data: { ...data, edges } };
}

export function findTask(data: GraphData, id: string): Task | null {
  return data.tasks.find((t) => t.id === id) ?? null;
}

// ─── project mutations ────────────────────────────────────────────────

export type ProjectResult =
  | { ok: true; store: ProjectStore; project: Project }
  | { ok: false; error: "invalid_name" | "project_not_found" | "last_project" };

export function addProject(store: ProjectStore, name: string): ProjectResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "invalid_name" };
  const project: Project = { id: crypto.randomUUID(), name: trimmed, version: 1, tasks: [], edges: [] };
  return { ok: true, store: { ...store, projects: [...store.projects, project] }, project };
}

export function renameProject(store: ProjectStore, id: string, name: string): ProjectResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "invalid_name" };
  const existing = store.projects.find((p) => p.id === id);
  if (!existing) return { ok: false, error: "project_not_found" };
  const project = { ...existing, name: trimmed };
  return { ok: true, store: { ...store, projects: store.projects.map((p) => (p.id === id ? project : p)) }, project };
}

/** Deleting a project also removes its tasks and dependencies. */
export function removeProject(store: ProjectStore, id: string): ProjectResult {
  const project = store.projects.find((p) => p.id === id);
  if (!project) return { ok: false, error: "project_not_found" };
  if (store.projects.length === 1) return { ok: false, error: "last_project" };
  return { ok: true, store: { ...store, projects: store.projects.filter((p) => p.id !== id) }, project };
}
