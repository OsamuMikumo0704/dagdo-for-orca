import { parseArgs } from "util";
import { loadGraph } from "../storage";
import { resolveId } from "../ids";
import { formatId } from "../format";
import { CliError } from "../cli-error";
import { computeTaskStates, describeTask, STATE_LABELS } from "../task-state";
import { printJson } from "./shared";

export async function showCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      json: { type: "boolean", default: false },
    },
  });

  if (positionals.length !== 1) {
    throw new CliError("invalid_input", "Usage: dagdo show <id> [--json]");
  }

  const data = await loadGraph();
  const id = resolveId(positionals[0]!, data.tasks.map((t) => t.id));
  const task = describeTask(data.tasks.find((t) => t.id === id)!, data.tasks, data.edges);

  if (values.json) {
    printJson({ task });
    return;
  }

  const states = computeTaskStates(data.tasks, data.edges);
  const related = (ids: string[]) => ids.map((other) => {
    const relatedTask = data.tasks.find((t) => t.id === other)!;
    return `  ${formatId(other)}  ${STATE_LABELS[states.get(other)!].padEnd(12)}  ${relatedTask.title}`;
  });

  const lines = [
    `${formatId(task.id)}  ${task.title}`,
    `State:    ${STATE_LABELS[task.state]}`,
    `Created:  ${task.createdAt}`,
  ];
  if (task.doneAt) lines.push(`Done:     ${task.doneAt}`);
  if (task.orcaWorkspace) lines.push(`Workspace: ${task.orcaWorkspace.displayName}  ${task.orcaWorkspace.branch}  ${task.orcaWorkspace.path}`);
  if (task.orcaCreation) lines.push(`Workspace creation pending: ${task.orcaCreation.name}`);
  if (task.dependsOn.length > 0) lines.push("Depends on:", ...related(task.dependsOn));
  if (task.dependents.length > 0) lines.push("Dependents:", ...related(task.dependents));
  if (task.notes) lines.push("Notes:", task.notes);
  console.log(lines.join("\n"));
}
