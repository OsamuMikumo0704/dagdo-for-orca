import { parseArgs } from "util";
import { loadGraph, saveGraph, withGraphLock } from "../storage";
import { resolveId } from "../ids";
import { formatId } from "../format";
import { CliError } from "../cli-error";
import { computeTaskStates, describeTask } from "../task-state";
import { printJson } from "./shared";

export async function doneCommand(args: string[]): Promise<void> {
  return withGraphLock(() => run(args));
}

async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
    },
  });

  if (positionals.length === 0) {
    throw new CliError("invalid_input", "Usage: dagdo done <id> [<id2> ...] [--json]");
  }

  const data = await loadGraph();
  const allIds = data.tasks.map((t) => t.id);
  const ids = [...new Set(positionals.map((prefix) => resolveId(prefix, allIds)))];
  const before = computeTaskStates(data.tasks, data.edges);
  const doneSet = new Set(data.tasks.filter((t) => t.doneAt != null).map((t) => t.id));

  for (const id of ids) {
    if (before.get(id) === "done") throw new CliError("already_done", `Task ${id} is already completed.`);

    if (data.tasks.find(t => t.id === id)!.progress === "backlog") throw new CliError("task_backlog", "Move the task out of Backlog before completing it.");
    // Check unfinished dependencies
    const blockers = data.edges
      .filter((e) => e.to === id && !doneSet.has(e.from))
      .map((e) => e.from);

    if (blockers.length > 0) {
      throw new CliError("task_blocked", `Task ${id} is blocked by: ${blockers.join(", ")}. Finish prerequisite tasks first.`);
    }

    data.tasks.find((t) => t.id === id)!.doneAt = new Date().toISOString();
    doneSet.add(id);
  }

  const tasks = ids.map((id) => data.tasks.find((t) => t.id === id)!);
  const message =
    tasks.length === 1
      ? `done: ${tasks[0]!.title}`
      : `done: ${tasks[0]!.title} + ${tasks.length - 1} more`;
  await saveGraph(data, message);

  // Find newly unblocked tasks
  const states = computeTaskStates(data.tasks, data.edges);
  const unblocked = data.tasks.filter((t) => before.get(t.id) === "blocked" && !["blocked", "done"].includes(states.get(t.id)!));

  if (values.json) {
    printJson({
      tasks: tasks.map((t) => describeTask(t, data.tasks, data.edges)),
      unblocked: unblocked.map(({ id, title }) => ({ id, title })),
    });
    return;
  }
  for (const task of tasks) console.log(`Done ${formatId(task.id)}  ${task.title}`);
  for (const task of unblocked) console.log(`  Unblocked: ${formatId(task.id)}  ${task.title}`);
}
