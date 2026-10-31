import { parseArgs } from "util";
import { loadGraph, saveGraph, withGraphLock } from "../storage";
import { resolveId } from "../ids";
import { formatId } from "../format";
import { CliError } from "../cli-error";
import { addEdge, addTask, updateTask } from "../graph/mutations";
import { describeTask, isProgress } from "../task-state";
import { edgeError, printJson, readNote, updateError } from "./shared";

export async function addCommand(args: string[]): Promise<void> {
  return withGraphLock(() => run(args));
}

async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      progress: { type: "string", default: "ready" },
      after: { type: "string", multiple: true, default: [] },
      before: { type: "string", multiple: true, default: [] },
      note: { type: "string" },
      "note-file": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const title = positionals.join(" ").trim();
  if (!title) {
    throw new CliError("invalid_title", "Usage: dagdo add <title> [--progress backlog|ready|in_progress] [--after <id>] [--before <id>] [--note <text> | --note-file <path>] [--json]");
  }

  const progress = values.progress;
  if (!isProgress(progress)) {
    throw new CliError("invalid_progress", `Invalid progress: "${progress}". Use: backlog, ready, in_progress`);
  }
  const note = readNote(values);

  const loaded = await loadGraph();
  const allIds = loaded.tasks.map((t) => t.id);
  const { data, task } = addTask(loaded, { title, progress });
  let graph = data;

  // --after <id>: that task must be done before this new task
  // --before <id>: this new task must be done before that task
  const edges = [
    ...values.after.map((prefix) => ({ from: resolveId(prefix, allIds), to: task.id })),
    ...values.before.map((prefix) => ({ from: task.id, to: resolveId(prefix, allIds) })),
  ];
  for (const edge of edges) {
    const result = addEdge(graph, edge);
    if (!result.ok) throw edgeError(result);
    graph = result.data;
  }

  if (note !== undefined) {
    const result = updateTask(graph, task.id, { notes: note });
    if (!result.ok) throw updateError(result);
    graph = result.data;
  }

  await saveGraph(graph, `add: ${task.title}`);
  if (values.json) {
    printJson({ task: describeTask(graph.tasks.find((t) => t.id === task.id)!, graph.tasks, graph.edges) });
    return;
  }
  console.log(`Created ${formatId(task.id)}  ${task.title}`);
}
