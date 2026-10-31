import { parseArgs } from "util";
import pc from "picocolors";
import { loadGraph } from "../storage";
import { computeTaskStates } from "../task-state";

export async function statusCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
    },
  });

  const data = await loadGraph();
  const states = [...computeTaskStates(data.tasks, data.edges).values()];
  const count = (state: string) => states.filter(s => s === state).length;

  const total = data.tasks.length;
  const done = data.tasks.filter((t) => t.doneAt != null).length;
  const active = total - done;
  const readyCount = count("ready");
  const inProgress = count("in_progress");
  const blocked = count("blocked");
  const backlog = count("backlog");

  if (values.json) {
    console.log(JSON.stringify({ total, done, active, ready: readyCount, inProgress, blocked, backlog }));
    return;
  }

  const bar = active > 0
    ? progressBar(done, total, 30)
    : pc.dim("no tasks");

  console.log(`${pc.bold("dagdo")} status\n`);
  console.log(`  Total:    ${total}`);
  console.log(`  Done:     ${pc.green(String(done))}`);
  console.log(`  Active:   ${active}`);
  console.log(`    Backlog: ${backlog}`);
  console.log(`    Ready:  ${pc.cyan(String(readyCount))}`);
  console.log(`    In Progress: ${inProgress}`);
  console.log(`    Blocked:${pc.yellow(` ${blocked}`)}`);
  console.log(`\n  ${bar}  ${total > 0 ? Math.round((done / total) * 100) : 0}%`);
}

function progressBar(filled: number, total: number, width: number): string {
  if (total === 0) return pc.dim("░".repeat(width));
  const ratio = filled / total;
  const complete = Math.round(ratio * width);
  return pc.green("█".repeat(complete)) + pc.dim("░".repeat(width - complete));
}
