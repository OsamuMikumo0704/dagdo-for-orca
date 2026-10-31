import { parseArgs } from "util";
import { loadGraph } from "../storage";
import { formatTaskTable } from "../format";
import { describeTask } from "../task-state";
import type { Task } from "../types";

export async function listCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      all: { type: "boolean", default: false },
      done: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });

  const data = await loadGraph();
  let tasks: Task[];

  if (values.done) {
    tasks = data.tasks.filter((t) => t.doneAt != null);
  } else if (values.all) {
    tasks = data.tasks;
  } else {
    tasks = data.tasks.filter((t) => t.doneAt == null);
  }
  // Compute blocker IDs for active tasks (only active blockers)
  const activeDone = new Set(data.tasks.filter((t) => t.doneAt != null).map((t) => t.id));
  const blockerIds = new Map<string, string[]>();
  for (const edge of data.edges) {
    if (!activeDone.has(edge.from)) {
      if (!blockerIds.has(edge.to)) blockerIds.set(edge.to, []);
      blockerIds.get(edge.to)!.push(edge.from);
    }
  }

  // Topological sort on the task set being listed
  const taskIds = new Set(tasks.map((t) => t.id));
  const inDegree = new Map<string, number>();
  for (const t of tasks) inDegree.set(t.id, 0);
  for (const edge of data.edges) {
    if (taskIds.has(edge.from) && taskIds.has(edge.to) && !activeDone.has(edge.from)) {
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }
  }

  const sorted: Task[] = [];
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const queue = tasks.filter((t) => (inDegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(taskMap.get(id)!);
    for (const edge of data.edges) {
      if (edge.from === id && taskIds.has(edge.to) && !activeDone.has(id)) {
        const deg = (inDegree.get(edge.to) ?? 1) - 1;
        inDegree.set(edge.to, deg);
        if (deg === 0) queue.push(edge.to);
      }
    }
  }
  // Append any remaining tasks not reached by topo sort (e.g. done tasks)
  for (const t of tasks) {
    if (!sorted.includes(t)) sorted.push(t);
  }

  if (values.json) {
    const result = sorted.map((t) => describeTask(t, data.tasks, data.edges));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(formatTaskTable(sorted, blockerIds));
}
