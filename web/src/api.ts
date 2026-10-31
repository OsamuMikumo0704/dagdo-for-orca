let currentProject = "default";
export function setApiProject(id:string) { currentProject = id; }
function scopedFetch(path:string, init?:RequestInit, projectId = currentProject) { return fetch(path.replace("/api/", `/api/projects/${encodeURIComponent(projectId)}/`),init); }
import type { TaskProgress, Task } from "./types";

/** fetch rejects with a TypeError only when no HTTP response arrived. */
export function isConnectionError(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message);
}

export async function isServerReachable(): Promise<boolean> {
  try {
    await fetch("/api/projects", { cache: "no-store", signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
}

export async function shutdownServer(): Promise<void> {
  const res = await fetch("/api/shutdown", { method: "POST" });
  await jsonOrThrow<{ ok: boolean }>(res);
}

export async function openWorkspace(projectId: string, taskId: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks/${taskId}/workspace/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  await jsonOrThrow<{ ok: boolean }>(res);
}

/**
 * Thin fetch wrapper — matches the server routes in src/server/server.ts.
 * The API surface mirrors src/graph/mutations.ts one-to-one.
 *
 * Errors carry a `kind` discriminator so callers can distinguish user
 * mistakes (cycle, duplicate) from infrastructure failures.
 */

export type ApiErrorKind =
  | "network"
  | "cycle"
  | "already_exists"
  | "task_not_found"
  | "task_blocked"
  | "self_loop"
  | "note_too_long"
  | "invalid"
  | "unknown";

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
    public detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let body: { error?: string; message?: string; path?: string[]; id?: string } = {};
  try {
    body = await res.json();
  } catch {
    // empty body — fall through to unknown
  }
  const kind: ApiErrorKind =
    body.error === "cycle" ? "cycle" :
    body.error === "already_exists" ? "already_exists" :
    body.error === "task_not_found" ? "task_not_found" :
    body.error === "task_blocked" ? "task_blocked" :
    body.error === "self_loop" ? "self_loop" :
    body.error === "note_too_long" ? "note_too_long" :
    body.error ? "invalid" :
    "unknown";
  throw new ApiError(kind, kind === "task_blocked" ? "Finish prerequisite tasks before marking this task as done." : body.message ?? body.error ?? `HTTP ${res.status}`, body);
}

export async function createTask(args: { title: string; progress?: TaskProgress; placement?: { mode: "tree" | "mindmap"; x: number; y: number } }, projectId = currentProject): Promise<Task> {
  const res = await scopedFetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  }, projectId);
  const body = await jsonOrThrow<{ task: Task }>(res);
  return body.task;
}

export type { HistoryState } from "../../src/server/history";
export async function mapAction(projectId: string, path: string, method: string, body?: unknown): Promise<import("../../src/server/history").HistoryState> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return jsonOrThrow(res);
}

export interface TaskPatch {
  title?: string;
  progress?: TaskProgress;
  doneAt?: string | null;
  notes?: string | null;
  clearDependencies?: boolean;
  placement?: { mode: "tree" | "mindmap"; x: number; y: number };
}

export async function updateTask(id: string, patch: TaskPatch, projectId = currentProject): Promise<Task> {
  const res = await scopedFetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }, projectId);
  const body = await jsonOrThrow<{ task: Task }>(res);
  return body.task;
}

export async function deleteTask(id: string, projectId = currentProject): Promise<void> {
  const res = await scopedFetch(`/api/tasks/${id}`, { method: "DELETE" }, projectId);
  if (!res.ok && res.status !== 404) await jsonOrThrow(res);
}

export async function createEdge(from: string, to: string, projectId = currentProject): Promise<void> {
  const res = await scopedFetch("/api/edges", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  }, projectId);
  if (!res.ok) await jsonOrThrow(res);
}

export async function deleteEdge(from: string, to: string, projectId = currentProject): Promise<void> {
  const res = await scopedFetch("/api/edges", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to }),
  }, projectId);
  if (!res.ok && res.status !== 404) await jsonOrThrow(res);
}
