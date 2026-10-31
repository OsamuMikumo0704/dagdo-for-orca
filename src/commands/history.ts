import { readFileSync } from "fs";
import { parseArgs } from "util";
import { readStore, selectedProject, serverStateFile } from "../storage";
import { CliError } from "../cli-error";
import type { HistoryState } from "../server/history";
import { printJson } from "./shared";

function notRunning(): CliError {
  return new CliError("server_not_running", "Undo history exists only while the UI server runs. Start it, or reverse the change with task commands.");
}

function serverUrl(): string {
  let state: { url: string; pid: number };
  try { state = JSON.parse(readFileSync(serverStateFile(), "utf8")); }
  catch { throw notRunning(); }
  // A force-stopped server leaves this file, and its port may now belong to another server.
  try { process.kill(state.pid, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") throw notRunning(); }
  return state.url;
}

/** The shared map history lives in server memory, so this drives the same routes as the browser buttons. */
export async function historyCommand(direction: "undo" | "redo", args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
    },
  });

  const project = selectedProject(readStore());
  const url = serverUrl();
  const route = `${url}/api/projects/${encodeURIComponent(project.id)}/history`;
  const call = async (path: string, init?: RequestInit) => {
    try { return await fetch(path, { ...init, proxy: "" }); }
    catch { throw notRunning(); }
  };

  const { revision } = await (await call(route)).json() as HistoryState;
  const response = await call(`${route}/${direction}`, {
    method: "POST",
    // The history routes accept same-origin requests only.
    headers: { "Content-Type": "application/json", Origin: url },
    body: JSON.stringify({ revision }),
  });
  const body = await response.json() as HistoryState & { error?: string; message?: string };
  if (!response.ok) {
    if (body.error === "history_empty") throw new CliError("history_empty", `Nothing to ${direction}.`);
    throw new CliError(body.error ?? "failed", body.message ?? `Could not ${direction}.`);
  }

  if (values.json) {
    printJson({ project: { id: project.id, name: project.name }, revision: body.revision, canUndo: body.canUndo, canRedo: body.canRedo });
    return;
  }
  console.log(`${direction === "undo" ? "Undid" : "Redid"} the latest change in ${project.name}.`);
}
