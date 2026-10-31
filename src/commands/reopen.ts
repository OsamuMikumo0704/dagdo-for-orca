import { parseArgs } from "util";
import { loadGraph, saveGraph, withGraphLock } from "../storage";
import { resolveId } from "../ids";
import { formatId } from "../format";
import { CliError } from "../cli-error";
import { updateTask } from "../graph/mutations";
import { computeTaskStates, describeTask } from "../task-state";
import { printJson, updateError } from "./shared";

export async function reopenCommand(args: string[]): Promise<void> {
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
    throw new CliError("invalid_input", "Usage: dagdo reopen <id> [<id2> ...] [--json]");
  }

  let data = await loadGraph();
  const allIds = data.tasks.map((t) => t.id);
  const ids = [...new Set(positionals.map((prefix) => resolveId(prefix, allIds)))];
  const before = computeTaskStates(data.tasks, data.edges);

  for (const id of ids) {
    if (before.get(id) !== "done") throw new CliError("not_done", `Task ${id} is not completed.`);
    const result = updateTask(data, id, { doneAt: null });
    if (!result.ok) throw updateError(result);
    data = result.data;
  }

  const tasks = ids.map((id) => data.tasks.find((t) => t.id === id)!);
  await saveGraph(data, `reopen: ${tasks.map((t) => t.title).join(", ")}`);

  // Reopening a prerequisite blocks its dependents again.
  const states = computeTaskStates(data.tasks, data.edges);
  const blocked = data.tasks.filter((t) => before.get(t.id) !== "blocked" && states.get(t.id) === "blocked");

  if (values.json) {
    printJson({
      tasks: tasks.map((t) => describeTask(t, data.tasks, data.edges)),
      blocked: blocked.map(({ id, title }) => ({ id, title })),
    });
    return;
  }
  for (const task of tasks) console.log(`Reopened ${formatId(task.id)}  ${task.title}`);
  for (const task of blocked) console.log(`  Blocked: ${formatId(task.id)}  ${task.title}`);
}
