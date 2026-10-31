import { parseArgs } from "util";
import { loadGraph, saveGraph, withGraphLock } from "../storage";
import { resolveId } from "../ids";
import { formatId } from "../format";
import { CliError } from "../cli-error";
import { updateTask, type TaskPatch } from "../graph/mutations";
import { describeTask, isProgress } from "../task-state";
import { printJson, readNote, updateError } from "./shared";

export async function editCommand(args: string[]): Promise<void> {
  return withGraphLock(() => run(args));
}

async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      title: { type: "string" },
      progress: { type: "string" },
      "clear-dependencies": { type: "boolean", default: false },
      note: { type: "string" },
      "note-file": { type: "string" },
      "clear-note": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });

  const prefix = positionals[0];
  if (prefix === undefined) {
    throw new CliError("invalid_input", "Usage: dagdo edit <id> [--title <new>] [--progress backlog|ready|in_progress] [--note <text> | --note-file <path>] [--clear-note] [--json]");
  }

  const patch: TaskPatch = {};
  if (values.title !== undefined) {
    patch.title = values.title.trim();
    if (!patch.title) throw new CliError("invalid_title", "Title cannot be empty.");
  }
  if (values.progress !== undefined) {
    if (!isProgress(values.progress)) {
      throw new CliError("invalid_progress", `Invalid progress: "${values.progress}". Use: backlog, ready, in_progress`);
    }
    patch.progress = values.progress;
  }
  if (values["clear-dependencies"]) patch.clearDependencies = true;
  const note = readNote(values);
  // A note and `--clear-note` are contradictory — reject up front rather
  // than picking an arbitrary winner.
  if (note !== undefined && values["clear-note"]) {
    throw new CliError("invalid_input", "--note and --clear-note are mutually exclusive.");
  }
  if (note !== undefined) patch.notes = note;
  if (values["clear-note"]) patch.notes = null;
  if (Object.keys(patch).length === 0) {
    throw new CliError("empty_patch", "Nothing to change. Pass --title, --progress, --note, --note-file or --clear-note.");
  }

  const data = await loadGraph();
  const id = resolveId(prefix, data.tasks.map((t) => t.id));
  const result = updateTask(data, id, patch);
  if (!result.ok) throw updateError(result);

  await saveGraph(result.data, `edit: ${result.task.title}`);
  if (values.json) {
    printJson({ task: describeTask(result.task, result.data.tasks, result.data.edges) });
    return;
  }
  console.log(`Updated ${formatId(id)}  ${result.task.title}`);
}
