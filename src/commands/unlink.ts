import { parseArgs } from "util";
import { loadGraph, saveGraph, withGraphLock } from "../storage";
import { resolveId } from "../ids";
import { formatId } from "../format";
import { CliError } from "../cli-error";
import { printJson } from "./shared";

export async function unlinkCommand(args: string[]): Promise<void> {
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

  if (positionals.length !== 2) {
    throw new CliError("invalid_input", "Usage: dagdo unlink <id-a> <id-b> [--json]\n  Removes the dependency between the two tasks (any direction).");
  }

  const data = await loadGraph();
  const allIds = data.tasks.map((t) => t.id);

  const idA = resolveId(positionals[0]!, allIds);
  const idB = resolveId(positionals[1]!, allIds);

  // Find the edge in either direction
  const idx = data.edges.findIndex(
    (e) => (e.from === idA && e.to === idB) || (e.from === idB && e.to === idA)
  );

  if (idx === -1) {
    throw new CliError("not_found", `No dependency between ${idA} and ${idB}.`);
  }

  const edge = data.edges[idx]!;
  const fromTask = data.tasks.find((t) => t.id === edge.from)!;
  const toTask = data.tasks.find((t) => t.id === edge.to)!;

  data.edges.splice(idx, 1);
  await saveGraph(data, `unlink: ${fromTask.title} x ${toTask.title}`);
  if (values.json) {
    printJson({ edge });
    return;
  }
  console.log(`Unlinked: ${formatId(edge.from)} ${fromTask.title}  ✕  ${formatId(edge.to)} ${toTask.title}`);
}
