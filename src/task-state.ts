import type { Edge, Task } from "./types";

export type TaskState = Task["progress"] | "blocked" | "done";
export const PROGRESS_VALUES = ["ready", "in_progress", "backlog"] as const;
export const STATE_LABELS: Record<TaskState, string> = {
  backlog: "Backlog", ready: "Ready", in_progress: "In Progress", blocked: "Blocked", done: "Done",
};
export function isProgress(value: unknown): value is Task["progress"] {
  return PROGRESS_VALUES.some(p => p === value);
}
export function computeTaskStates(tasks: Task[], edges: Edge[]): Map<string, TaskState> {
  const unfinished = new Set(tasks.filter(t => t.doneAt == null).map(t => t.id));
  const blocked = new Set(edges.filter(e => unfinished.has(e.from)).map(e => e.to));
  return new Map(tasks.map(t => [t.id, t.doneAt != null ? "done" : blocked.has(t.id) ? "blocked" : t.progress]));
}
/** The task shape in CLI JSON: stored fields plus its effective state and dependencies. */
export function describeTask(task: Task, tasks: Task[], edges: Edge[]) {
  const unfinished = new Set(tasks.filter(t => t.doneAt == null).map(t => t.id));
  const dependsOn = edges.filter(e => e.to === task.id).map(e => e.from);
  return {
    ...task,
    state: computeTaskStates(tasks, edges).get(task.id)!,
    blockedBy: dependsOn.filter(id => unfinished.has(id)),
    dependsOn,
    dependents: edges.filter(e => e.from === task.id).map(e => e.to),
  };
}
