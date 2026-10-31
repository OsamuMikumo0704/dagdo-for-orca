import { parseArgs } from "util";
import { loadGraph, saveGraph, withGraphLock } from "../storage";
import { resolveId } from "../ids";
import { formatId } from "../format";
import { CliError } from "../cli-error";
import { printJson } from "./shared";

export async function removeCommand(args: string[]): Promise<void> {
  return withGraphLock(() => run(args));
}

async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      force: { type: "boolean", short: "f", default: false },
      json: { type: "boolean", default: false },
    },
  });

  if (positionals.length === 0) {
    throw new CliError("invalid_input", "Usage: dagdo rm <id> [<id2> ...] [--force] [--json]");
  }

  const data = await loadGraph();
  const allIds = data.tasks.map((t) => t.id);
  const ids = new Set(positionals.map((prefix) => resolveId(prefix, allIds)));

  // Check if tasks outside this removal depend on it
  const dependents = new Set(data.edges.filter((e) => ids.has(e.from) && !ids.has(e.to)).map((e) => e.to));
  if (dependents.size > 0 && !values.force) {
    throw new CliError("has_dependents", `Removal would unlink ${dependents.size} dependent task(s): ${[...dependents].join(", ")}. Use --force to remove.`);
  }

  const removed = data.tasks.filter((t) => ids.has(t.id));
  data.tasks = data.tasks.filter((t) => !ids.has(t.id));
  data.edges = data.edges.filter((e) => !ids.has(e.from) && !ids.has(e.to));

  await saveGraph(data, `rm: ${removed.map((t) => t.title).join(", ")}`);
  if (values.json) {
    printJson({ removed: removed.map(({ id, title }) => ({ id, title })) });
    return;
  }
  for (const task of removed) console.log(`Removed ${formatId(task.id)}  ${task.title}`);
}
