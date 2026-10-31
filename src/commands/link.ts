import { parseArgs } from "util";
import { loadGraph, saveGraph, withGraphLock } from "../storage";
import { resolveId } from "../ids";
import { formatId } from "../format";
import { CliError } from "../cli-error";
import { addEdge } from "../graph/mutations";
import { edgeError, printJson } from "./shared";

export async function linkCommand(args: string[]): Promise<void> {
  return withGraphLock(() => run(args));
}

async function run(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      before: { type: "string" },
      after: { type: "string" },
      json: { type: "boolean", default: false },
    },
  });

  const id = positionals[0];
  const other = values.before ?? values.after;
  if (id === undefined || other === undefined || (values.before !== undefined && values.after !== undefined)) {
    throw new CliError("invalid_input", [
      "Usage: dagdo link <id> --before <other> [--json]",
      "       dagdo link <id> --after <other> [--json]",
      "  --before: <id> must be done before <other>",
      "  --after:  <id> must be done after <other>",
    ].join("\n"));
  }

  const data = await loadGraph();
  const allIds = data.tasks.map((t) => t.id);
  const taskId = resolveId(id, allIds);
  const otherId = resolveId(other, allIds);

  // Resolve from/to based on --before or --after
  const edge = values.before !== undefined ? { from: taskId, to: otherId } : { from: otherId, to: taskId };
  const result = addEdge(data, edge);
  if (!result.ok) throw edgeError(result);

  const fromTask = data.tasks.find((t) => t.id === edge.from)!;
  const toTask = data.tasks.find((t) => t.id === edge.to)!;
  await saveGraph(result.data, `link: ${fromTask.title} -> ${toTask.title}`);
  if (values.json) {
    printJson({ edge });
    return;
  }
  console.log(`Linked: ${formatId(edge.from)} ${fromTask.title}  →  ${formatId(edge.to)} ${toTask.title}`);
}
