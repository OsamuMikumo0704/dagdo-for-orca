import { randomBytes } from "crypto";
import { CliError } from "./cli-error";
import type { TaskId } from "./types";

export function generateId(): TaskId {
  return randomBytes(3).toString("hex");
}

export function resolveId(prefix: string, ids: TaskId[]): TaskId {
  // An empty prefix matches every ID, so an unset shell variable must not select a task.
  if (!prefix) throw new CliError("invalid_input", "Task ID is empty.");
  const matches = ids.filter((id) => id.startsWith(prefix));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new CliError("task_not_found", `No task found matching "${prefix}".`);
  throw new CliError("ambiguous_id", `"${prefix}" is ambiguous, matches: ${matches.join(", ")}`);
}
