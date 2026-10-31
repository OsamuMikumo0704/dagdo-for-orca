import { parseArgs } from "util";
import { loadGraph } from "../storage";
import { buildActiveGraph } from "../graph/dag";
import { getReadyTasks } from "../graph/topo";
import { formatTaskTable } from "../format";
import { describeTask } from "../task-state";

export async function nextCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      limit: { type: "string", short: "n", default: "10" },
      json: { type: "boolean", default: false },
    },
  });

  const limit = parseInt(values.limit as string, 10);
  const data = await loadGraph();
  const graph = buildActiveGraph(data);
  const ready = getReadyTasks(graph).slice(0, limit);

  if (values.json) {
    console.log(JSON.stringify(ready.map((t) => describeTask(t, data.tasks, data.edges)), null, 2));
    return;
  }

  if (ready.length === 0) {
    const activeCount = data.tasks.filter((t) => t.doneAt == null && t.progress !== "backlog").length;
    if (activeCount === 0 && data.tasks.some(t => t.doneAt == null && t.progress === "backlog")) {
      console.log("No actionable tasks. Move a Backlog task to Ready to get started.");
    } else if (activeCount === 0) {
      console.log("No tasks. Run `dagdo add` to get started.");
    } else {
      console.log("No ready tasks — all active tasks are blocked.");
    }
    return;
  }

  console.log(formatTaskTable(ready));
}
