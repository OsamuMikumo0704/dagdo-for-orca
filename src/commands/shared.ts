import { readFileSync } from "fs";
import { resolve } from "path";
import { CliError } from "../cli-error";
import type { AddEdgeResult, UpdateTaskResult } from "../graph/mutations";

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value));
}

/** Prefer `--note-file` for quoted or multi-line text: Windows PowerShell 5.1 drops `"` from native arguments. */
export function readNote(values: { note?: string; "note-file"?: string }): string | undefined {
  const file = values["note-file"];
  if (file === undefined) return values.note;
  if (values.note !== undefined) throw new CliError("invalid_input", "--note and --note-file are mutually exclusive.");
  try {
    // The launchers run from different directories, so resolve against the caller.
    const text = readFileSync(resolve(process.env.DAGDO_CALLER_CWD || process.cwd(), file), "utf8");
    return text.replace(/^﻿/, "").replace(/\r?\n$/, "");
  } catch {
    throw new CliError("invalid_input", `Cannot read note file: ${file}`);
  }
}

export function edgeError(result: Extract<AddEdgeResult, { ok: false }>): CliError {
  switch (result.error) {
    case "task_backlog": return new CliError(result.error, "Move the task out of Backlog before adding dependencies.");
    case "self_loop": return new CliError(result.error, "A task cannot depend on itself.");
    case "task_not_found": return new CliError(result.error, `No task found: ${result.id}`);
    case "already_exists": return new CliError(result.error, "This dependency already exists.");
    case "cycle": return new CliError(result.error, `Cannot add: would create a cycle: ${result.path.join(" -> ")}`);
  }
}

export function updateError(result: Extract<UpdateTaskResult, { ok: false }>): CliError {
  switch (result.error) {
    case "task_not_found": return new CliError(result.error, "Task not found.");
    case "task_backlog": return new CliError(result.error, "Move the task out of Backlog before completing it.");
    case "backlog_dependencies": return new CliError(result.error, "Use --clear-dependencies to move this task to Backlog and remove its dependencies.");
    case "invalid_input": return new CliError(result.error, "--clear-dependencies requires --progress backlog.");
    case "task_blocked": return new CliError(result.error, "Finish prerequisite tasks first.");
    case "note_too_long": return new CliError(result.error, `Note too long (limit ${result.limit} chars).`);
  }
}
