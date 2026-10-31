import type { AdjacencyGraph, Task, TaskId } from "../types";

/**
 * Get tasks with zero in-degree (no unfinished blockers).
 * Sorted by creation date (oldest first).
 */
export function getReadyTasks(graph: AdjacencyGraph): Task[] {
  const ready: Task[] = [];
  for (const [id, deps] of graph.inEdges) {
    if (deps.size === 0) {
      const task = graph.tasks.get(id);
      if (task && task.progress !== "backlog") ready.push(task);
    }
  }
  ready.sort((a, b) => {
    return a.createdAt.localeCompare(b.createdAt);
  });
  return ready;
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns ordered task IDs and their level (distance from sources).
 */
export function topologicalSort(graph: AdjacencyGraph): { order: TaskId[]; levels: Map<TaskId, number> } {
  const inDegree = new Map<TaskId, number>();
  for (const [id, deps] of graph.inEdges) {
    inDegree.set(id, deps.size);
  }

  const queue: TaskId[] = [];
  const levels = new Map<TaskId, number>();

  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
      levels.set(id, 0);
    }
  }

  const order: TaskId[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    const currentLevel = levels.get(current)!;

    for (const neighbor of graph.outEdges.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
        levels.set(neighbor, currentLevel + 1);
      }
    }
  }

  return { order, levels };
}
