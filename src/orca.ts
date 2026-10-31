import { existsSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { readStore, saveStore, selectedProject, globalDataDir, withGraphLock as graphLock, withOrcaWrite, withProject } from "./storage";
import { CliError } from "./cli-error";
import { resolveId } from "./ids";
import { computeTaskStates } from "./task-state";
import type { OrcaCreation, OrcaWorkspace } from "./types";
const withGraphLock = <T>(action: () => Promise<T>) => withOrcaWrite(() => graphLock(action));

export class OrcaError extends CliError {}
const ORCA_TIMEOUT_MS = 60_000;
let selectedCommand: string | undefined;
let testRunner: ((args: string[], cwd: string) => Promise<any>) | undefined;
/** In-process dependency injection for isolated integration tests; never exposed over HTTP. */
export function setOrcaRunnerForTests(runner?: typeof testRunner) { testRunner = runner; }
const activeCreations = new Set<string>();
export async function orca(args: string[], cwd = process.cwd()): Promise<any> {
  if (testRunner) return testRunner(args, cwd);
  if (!selectedCommand) {
    const configured = process.env.DAGDO_ORCA_COMMAND || process.env.ORCA_CLI_COMMAND;
    const installed = join(process.env.LOCALAPPDATA || "", "Programs/orca/resources/bin/orca.exe");
    selectedCommand = configured || Bun.which("orca.exe") || Bun.which("orca") || (existsSync(installed) ? installed : "orca");
  }
  const env = { ...process.env };
  delete env.ORCA_ENVIRONMENT; delete env.ORCA_PAIRING_CODE;
  let child;
  try { child = Bun.spawn([selectedCommand, ...args, "--json"], { cwd, env, stdout: "pipe", stderr: "pipe" }); }
  catch { throw new OrcaError("orca_unavailable", "Orca CLI could not be started. Check DAGDO_ORCA_COMMAND."); }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, ORCA_TIMEOUT_MS);
  try {
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (timedOut) throw new OrcaError("orca_uncertain", "Orca timed out. Check the workspace before retrying.");
    let reply;
    try { reply = JSON.parse(stdout); } catch { throw new OrcaError("orca_uncertain", "Orca returned an unreadable response. Check the workspace before retrying."); }
    if (!reply.ok || exit !== 0) throw new OrcaError(reply.error?.code || "orca_failed", reply.error?.message || stderr || "Orca command failed.");
    return reply.result;
  } finally { clearTimeout(timer); }
}

export async function projects() {
  const [p, s, r] = await Promise.all([orca(["project", "list"]), orca(["project", "setups", "--host", "local"]), orca(["repo", "list"])]);
  return s.setups.filter((x: any) => x.hostId === "local" && x.kind === "git" && x.setupState === "ready").map((x: any) => ({
    id: x.id, repoId: x.repoId, projectId: x.projectId, path: x.path,
    displayName: p.projects.find((a: any) => a.id === x.projectId)?.displayName || x.displayName,
    baseRef: r.repos.find((a: any) => a.id === x.repoId)?.worktreeBaseRef || "",
  }));
}
function getTask(store: ReturnType<typeof readStore>, projectId: string, taskId: string) {
  const project = store.projects.find(p => p.id === projectId);
  const task = project?.tasks.find(t => t.id === taskId);
  if (!project || !task) throw new OrcaError("task_not_found", "Task not found.");
  return { project, task };
}
function link(worktree: any, creation: OrcaCreation): OrcaWorkspace {
  if (!worktree?.identity?.key || worktree.hostId !== "local" || worktree.repoId !== creation.repoId) throw new OrcaError("orca_uncertain", "Orca returned an unexpected workspace.");
  return { identityKey: worktree.identity.key, id: worktree.id, repoId: worktree.repoId, projectId: worktree.projectId,
    setupId: creation.setupId, path: worktree.path, displayName: worktree.displayName, branch: worktree.branch || "", createdAt: new Date().toISOString() };
}
async function finish(projectId: string, taskId: string, requestId: string, worktree: any) {
  return withGraphLock(async () => {
    const store = readStore(); const { task } = getTask(store, projectId, taskId);
    if (!task.orcaCreation || task.orcaCreation.requestId !== requestId) throw new OrcaError("creation_conflict", "Workspace creation changed. Refresh this task.");
    const binding = link(worktree, task.orcaCreation);
    if (store.projects.some(p => p.tasks.some(t => t.orcaWorkspace?.identityKey === binding.identityKey))) throw new OrcaError("workspace_linked", "This workspace is already linked to a task.");
    task.orcaWorkspace = binding; delete task.orcaCreation; task.progress = "in_progress";
    await saveStore(store); return task;
  });
}
export async function createWorkspace(projectId: string, taskId: string, input: any) {
  if (!input || typeof input.name !== "string" || !input.name.trim() || typeof input.setupId !== "string" ||
    !["inherit", "run", "skip"].includes(input.setup ?? "inherit") ||
    [input.branch, input.baseBranch].some(v => v !== undefined && typeof v !== "string")) throw new OrcaError("invalid_input", "Choose a project and workspace name.");
  const target = (await projects()).find((p: any) => p.id === input.setupId);
  if (!target) throw new OrcaError("invalid_project", "Select an available local Git project.");
  const creation: OrcaCreation = { requestId: crypto.randomUUID(), setupId: target.id, repoId: target.repoId,
    name: input.name.trim(), setup: input.setup ?? "inherit", baseBranch: input.baseBranch || undefined, branch: input.branch || undefined, startedAt: new Date().toISOString() };
  await withGraphLock(async () => {
    const store = readStore(); const { project, task } = getTask(store, projectId, taskId);
    if (task.orcaWorkspace || task.orcaCreation) throw new OrcaError("workspace_exists", "This task already has a workspace or pending creation.");
    if (computeTaskStates(project.tasks, project.edges).get(taskId) !== "ready") throw new OrcaError("task_not_ready", "Only Ready tasks can create a workspace.");
    task.orcaCreation = creation; await saveStore(store);
  });
  activeCreations.add(creation.requestId);
  try {
    const args = ["worktree", "create", "--project-host-setup", creation.setupId, "--name", creation.name, "--no-parent", "--setup", creation.setup,
      "--comment", `DAGDO ${projectId}/${taskId} create:${creation.requestId}`];
    if (creation.baseBranch) args.push("--base-branch", creation.baseBranch);
    if (creation.branch) args.push("--branch", creation.branch);
    const result = await orca(args);
    return await finish(projectId, taskId, creation.requestId, result.worktree);
  } catch (error) {
    // Keep the reservation on ANY ambiguous result, including a save failure.
    await withGraphLock(async () => {
      const store = readStore(); const { task } = getTask(store, projectId, taskId);
      if (task.orcaCreation?.requestId === creation.requestId) {
        if (error instanceof OrcaError && ["invalid_argument", "invalid_ref", "orca_unavailable", "runtime_not_running"].includes(error.code)) delete task.orcaCreation;
        else task.orcaCreation.uncertain = true;
        await saveStore(store);
      }
    });
    throw error;
  } finally { activeCreations.delete(creation.requestId); }
}
export async function workspaceState(projectId: string, taskId: string) {
  const { task } = getTask(readStore(), projectId, taskId);
  const launcher = fileURLToPath(new URL("../scripts/dagdo.ts", import.meta.url));
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  const command = (action: string) => `& { $previousDagdoData = $env:DAGDO_DATA_DIR; try { $env:DAGDO_DATA_DIR = ${quote(globalDataDir())}; bun run ${quote(launcher)} workspace ${action} --workspace ${quote(task.orcaWorkspace!.identityKey)} --json } finally { $env:DAGDO_DATA_DIR = $previousDagdoData } }`;
  const instructions = task.orcaWorkspace ? `Inspect the task:\n${command("task")}\n\nAfter completing the work, mark the task done:\n${command("done")}` : "";
  if (!task.orcaWorkspace) return { task, status: task.orcaCreation ? "pending" : "none", instructions };
  try {
    const result = await orca(["worktree", "show", "--worktree", "identity:" + task.orcaWorkspace.identityKey]);
    return { task, status: result.worktree.isArchived ? "archived" : "available", worktree: result.worktree, instructions };
  } catch (error) {
    if (error instanceof OrcaError && /not.?found|missing/.test(error.code)) return { task, status: "missing", instructions };
    return { task, status: "unavailable", instructions, message: error instanceof Error ? error.message : String(error) };
  }
}
export async function openWorkspace(projectId: string, taskId: string) {
  const state = await workspaceState(projectId, taskId);
  if (state.status !== "available") throw new OrcaError("workspace_unavailable", "This workspace is unavailable or archived.");
  const selector = "identity:" + state.task.orcaWorkspace!.identityKey;
  const result = await orca(["terminal", "list", "--worktree", selector]);
  const terminal = result.terminals?.[0];
  if (terminal) await orca(["terminal", "switch", "--terminal", terminal.handle || terminal.id]);
  else await orca(["terminal", "create", "--worktree", selector, "--focus"]);
  return { ok: true };
}
export async function unlinkWorkspace(projectId: string, taskId: string) {
  const state = await workspaceState(projectId, taskId);
  if (!["missing", "archived"].includes(state.status)) throw new OrcaError("workspace_active", "Only missing or archived workspaces can be unlinked.");
  return withGraphLock(async () => {
    const store = readStore(); const { task } = getTask(store, projectId, taskId);
    if (task.orcaWorkspace?.identityKey !== state.task.orcaWorkspace?.identityKey) throw new OrcaError("creation_conflict", "Workspace changed. Refresh this task.");
    delete task.orcaWorkspace; task.progress = "ready"; task.doneAt = null;
    await saveStore(store); return { task };
  });
}
export async function reconcile(projectId: string, taskId: string, input: any) {
  const { task } = getTask(readStore(), projectId, taskId); const pending = task.orcaCreation;
  if (!pending) throw new OrcaError("no_pending_creation", "There is no pending workspace creation.");
  // activeCreations only sees this process. Another process may own a recent, unsettled reservation.
  const unsettled = !pending.uncertain && Date.now() - Date.parse(pending.startedAt) < ORCA_TIMEOUT_MS + 30_000;
  if (activeCreations.has(pending.requestId) || unsettled) throw new OrcaError("creation_busy", "Workspace creation is still running.");
  if (input?.reset === true) return withGraphLock(async () => {
    const store = readStore(); const current = getTask(store, projectId, taskId).task;
    if (current.orcaCreation?.requestId !== pending.requestId) throw new OrcaError("creation_conflict", "Creation changed.");
    delete current.orcaCreation; await saveStore(store); return { task: current };
  });
  let worktree;
  if (input?.workspace) worktree = (await orca(["worktree", "show", "--worktree", input.workspace])).worktree;
  else {
    const result = await orca(["worktree", "list", "--repo", "id:" + pending.repoId, "--limit", "10000"]);
    if (result.truncated) throw new OrcaError("incomplete_results", "Workspace list is incomplete. Specify the workspace identity.");
    const matches = result.worktrees.filter((w: any) => w.comment?.includes(`create:${pending.requestId}`));
    if (matches.length !== 1) throw new OrcaError("recovery_required", "No unique match. Specify an existing workspace selector, or confirm the attempt did not create one before resetting.");
    worktree = matches[0];
  }
  return { task: await finish(projectId, taskId, pending.requestId, worktree) };
}
const WORKSPACE_USAGE = [
  "Usage: dagdo workspace task|done [--workspace <identity-or-id> | --cwd <path>] [--project <ID>] [--json]",
  "       dagdo workspace projects|start [--json]",
  "       dagdo workspace refs --orca-project <setup-id> [--query <text>] [--json]",
  "       dagdo workspace create --task <id> --orca-project <setup-id> [--name <text>] [--base <ref>] [--branch <name>] [--hooks inherit|run|skip] [--open] [--project <ID>] [--json]",
  "       dagdo workspace status|open|unlink --task <id> [--project <ID>] [--json]",
  "       dagdo workspace reconcile --task <id> [--workspace <selector> | --reset] [--project <ID>] [--json]",
].join("\n");
async function taskWorkspaceAction(action: string, values: Record<string, string | boolean | undefined>, projectId?: string) {
  const prefix = values.task;
  if (typeof prefix !== "string") throw new OrcaError("invalid_input", WORKSPACE_USAGE);
  const project = withProject(projectId ?? "", () => selectedProject(readStore()));
  const taskId = resolveId(prefix, project.tasks.map(t => t.id));
  switch (action) {
    case "status": {
      const state = await workspaceState(project.id, taskId);
      return { result: state, text: `${state.status} ${taskId}  ${state.task.title}${state.task.orcaWorkspace ? `\nWorkspace: ${state.task.orcaWorkspace.displayName}` : ""}` };
    }
    case "open":
      return { result: await openWorkspace(project.id, taskId), text: `Opened the workspace for ${taskId}.` };
    case "unlink":
      return { result: await unlinkWorkspace(project.id, taskId), text: `Unlinked the workspace from ${taskId}. The task is Ready.` };
    case "reconcile": {
      if (values.reset && values.workspace) throw new OrcaError("invalid_input", WORKSPACE_USAGE);
      const { task } = await reconcile(project.id, taskId, values.reset ? { reset: true } : { workspace: values.workspace });
      return { result: { task }, text: `${task.orcaWorkspace ? "Linked " + task.orcaWorkspace.displayName : "Reset the pending creation"} for ${taskId}.` };
    }
    default: {
      const title = project.tasks.find(t => t.id === taskId)!.title;
      const task = await createWorkspace(project.id, taskId, { setupId: values["orca-project"], name: values.name ?? title, baseBranch: values.base, branch: values.branch, setup: values.hooks });
      // The workspace exists from here on, so a failed open must not read as a failed creation.
      let openError: string | undefined;
      if (values.open) { try { await openWorkspace(project.id, taskId); } catch (error) { openError = error instanceof Error ? error.message : String(error); } }
      return { result: { task, opened: !!values.open && !openError, ...(openError ? { openError } : {}) }, text: `Created workspace ${task.orcaWorkspace!.displayName} for ${taskId}.${openError ? ` It could not be opened: ${openError}` : ""}` };
    }
  }
}
export async function workspaceCommand(args: string[], projectId?: string) {
  const { parseArgs } = await import("util");
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      workspace: { type: "string" }, cwd: { type: "string" }, json: { type: "boolean" }, task: { type: "string" }, "orca-project": { type: "string" },
      name: { type: "string" }, base: { type: "string" }, branch: { type: "string" }, hooks: { type: "string" }, open: { type: "boolean" }, reset: { type: "boolean" }, query: { type: "string" },
    } });
    const action = positionals[0] || "";
    if (positionals.length !== 1) throw new OrcaError("invalid_input", WORKSPACE_USAGE);
    const print = ({ result, text }: { result: unknown; text: string }) => console.log(values.json ? JSON.stringify(result) : text);
    if (action === "projects") {
      const result = await projects();
      return print({ result: { projects: result }, text: result.map((p: any) => `${p.id}  ${p.displayName}  ${p.path}`).join("\n") });
    }
    if (action === "refs") {
      const target = (await projects()).find((p: any) => p.id === values["orca-project"]);
      if (!target) throw new OrcaError("invalid_project", "Select an available local Git project.");
      const result = await orca(["repo", "search-refs", "--repo", "id:" + target.repoId, "--query", values.query || "", "--limit", "30"]);
      return print({ result, text: (result.refs ?? []).map((r: any) => typeof r === "string" ? r : r.ref || r.name).join("\n") });
    }
    if (action === "start") { await orca(["open"]); return print({ result: { ok: true }, text: "Orca started." }); }
    if (["status", "create", "open", "reconcile", "unlink"].includes(action)) return print(await taskWorkspaceAction(action, values, projectId));
    if (!["task", "done"].includes(action) || (values.workspace && values.cwd)) throw new OrcaError("invalid_input", WORKSPACE_USAGE);
    let identity = values.workspace?.replace(/^(identity:|id:)/, "");
    if (!identity) identity = (await orca(["worktree", "current"], resolve(values.cwd || process.env.DAGDO_CALLER_CWD || process.cwd()))).worktree.identity.key;
    return await withGraphLock(async () => {
      const store = readStore();
      const matches = store.projects.filter(p => !projectId || p.id === projectId).flatMap(p => p.tasks.filter(t => t.orcaWorkspace && [t.orcaWorkspace.identityKey, t.orcaWorkspace.id].includes(identity!)).map(task => ({ project: p, task })));
      if (matches.length !== 1) throw new OrcaError(matches.length ? "ambiguous_workspace" : "task_not_found", "Expected exactly one linked task in this data store.");
      const { project, task } = matches[0]!;
      const before = computeTaskStates(project.tasks, project.edges); let changed = false;
      if (positionals[0] === "done" && !task.doneAt) {
        if (before.get(task.id) === "blocked") throw new OrcaError("task_blocked", "Finish prerequisite tasks first.");
        task.doneAt = new Date().toISOString(); await saveStore(store); changed = true;
      }
      const states = computeTaskStates(project.tasks, project.edges);
      const result = { project: { id: project.id, name: project.name }, task, state: states.get(task.id), workspace: task.orcaWorkspace, changed,
        unblocked: project.tasks.filter(t => before.get(t.id) === "blocked" && states.get(t.id) !== "blocked").map(t => ({ id: t.id, title: t.title })) };
      console.log(values.json ? JSON.stringify(result) : `${states.get(task.id)} ${task.id}  ${task.title}\nProject: ${project.name}\nWorkspace: ${task.orcaWorkspace!.displayName}`);
    });
  } catch (error) {
    console.error(args.includes("--json") ? JSON.stringify({ error: error instanceof CliError ? error.code : "invalid_input", message: String(error instanceof Error ? error.message : error) }) : String(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  }
}
