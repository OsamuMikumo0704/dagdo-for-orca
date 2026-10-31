import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createWorkspace, openWorkspace, OrcaError, reconcile, setOrcaRunnerForTests, unlinkWorkspace, workspaceCommand, workspaceState } from "../src/orca";
import { readStore, saveStore, withGraphLock, withOrcaWrite, withProject, validateGraph } from "../src/storage";
import type { Task } from "../src/types";

describe("Orca integration", () => {
  let dir: string, old: string | undefined;
  let worktrees: any[], calls: string[][], fail: boolean, archived: boolean, missing: boolean;
  const task = (): Task => ({ id: "abcdef", title: "日本語 task ' $()", progress: "ready", createdAt: new Date().toISOString(), doneAt: null });
  beforeEach(async () => {
    old = process.env.DAGDO_DATA_DIR; dir = mkdtempSync(join(tmpdir(), "dagdo-orca-")); process.env.DAGDO_DATA_DIR = dir;
    calls = []; worktrees = []; fail = archived = missing = false;
    setOrcaRunnerForTests(async args => {
      calls.push(args);
      const command = args.slice(0, 2).join(" ");
      if (command === "project list") return { projects: [{ id: "project", displayName: "Test project" }] };
      if (command === "project setups") return { setups: [{ id: "setup", projectId: "project", repoId: "repo", hostId: "local", kind: "git", setupState: "ready", path: dir }] };
      if (command === "repo list") return { repos: [{ id: "repo", worktreeBaseRef: "main" }] };
      if (command === "worktree create") {
        const w = { id: "repo::" + dir, identity: { key: "wt2:local:unique" }, repoId: "repo", hostId: "local", projectId: "project", path: dir,
          displayName: args[args.indexOf("--name") + 1], branch: "feature/test", comment: args[args.indexOf("--comment") + 1] };
        worktrees.push(w);
        if (fail) throw new OrcaError("orca_uncertain", "Reply lost");
        return { worktree: w };
      }
      if (command === "worktree list") return { worktrees, truncated: false };
      if (command === "worktree show" || command === "worktree current") {
        if (missing) throw new OrcaError("worktree_not_found", "Missing");
        return { worktree: { ...worktrees[0], isArchived: archived } };
      }
      if (command === "terminal list") return { terminals: [{ handle: "fresh-handle" }] };
      if (command === "terminal switch") return { ok: true };
      if (command === "repo search-refs") return { refs: ["main", { ref: "origin/dev" }] };
      if (command === "open") return { ok: true };
      throw new Error("Unexpected command: " + command);
    });
    await withGraphLock(async () => { const store = readStore(); store.projects[0]!.tasks.push(task()); await saveStore(store); });
  });
  afterEach(() => { setOrcaRunnerForTests(); if (old === undefined) delete process.env.DAGDO_DATA_DIR; else process.env.DAGDO_DATA_DIR = old; rmSync(dir, { recursive: true, force: true }); });
  it("creates, persists, opens, completes by cwd across projects and repeats completion safely", async () => {
    await withGraphLock(async () => { const store = readStore(); store.projects.push({ id: "other", name: "Other", version: 1, tasks: [], edges: [] }); await saveStore(store); });
    const result = await createWorkspace("default", "abcdef", { setupId: "setup", name: task().title });
    expect(result.progress).toBe("in_progress"); expect(result.orcaCreation).toBeUndefined();
    expect(calls.find(c => c[1] === "create")).toContain(task().title);
    expect(calls.find(c => c[1] === "create")).toContain("--no-parent");
    await openWorkspace("default", "abcdef"); expect(calls.at(-1)).toContain("fresh-handle");
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await workspaceCommand(["task", "--cwd", dir, "--json"]);
      expect(JSON.parse(log.mock.calls.at(-1)![0]).project.id).toBe("default");
      await workspaceCommand(["done", "--workspace", result.orcaWorkspace!.identityKey, "--json"]);
      expect(JSON.parse(log.mock.calls.at(-1)![0]).changed).toBe(true);
      const doneAt = readStore().projects[0]!.tasks[0]!.doneAt;
      await workspaceCommand(["done", "--workspace", result.orcaWorkspace!.identityKey, "--json"]);
      expect(JSON.parse(log.mock.calls.at(-1)![0]).changed).toBe(false);
      expect(readStore().projects[0]!.tasks[0]!.doneAt).toBe(doneAt);
    } finally { log.mockRestore(); }
  });
  it("rejects blocked, in-progress and duplicate creation", async () => {
    await withGraphLock(async () => { const store = readStore(); store.projects[0]!.tasks[0]!.progress = "in_progress"; await saveStore(store); });
    await expect(createWorkspace("default", "abcdef", { setupId: "setup", name: "test" })).rejects.toThrow("Ready");
    await withGraphLock(async () => { const store = readStore(); store.projects[0]!.tasks[0]!.progress = "ready"; store.projects[0]!.tasks.push({ ...task(), id: "111111" }); store.projects[0]!.edges.push({ from: "111111", to: "abcdef" }); await saveStore(store); });
    await expect(createWorkspace("default", "abcdef", { setupId: "setup", name: "test" })).rejects.toThrow("Ready");
    await withGraphLock(async () => { const store = readStore(); store.projects[0]!.edges = []; await saveStore(store); });
    const results = await Promise.allSettled([1, 2].map(() => createWorkspace("default", "abcdef", { setupId: "setup", name: "test" })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(worktrees).toHaveLength(1);
  });
  it("retains uncertain creation, protects it from writers, and recovers without creating again", async () => {
    fail = true;
    await expect(createWorkspace("default", "abcdef", { setupId: "setup", name: "test" })).rejects.toThrow("Reply lost");
    expect(readStore().projects[0]!.tasks[0]!.progress).toBe("ready");
    await expect(withGraphLock(async () => { const store = readStore(); store.projects[0]!.tasks = []; await saveStore(store); })).rejects.toThrow("pending");
    await reconcile("default", "abcdef", {}); expect(worktrees).toHaveLength(1);
    expect(readStore().projects[0]!.tasks[0]!.orcaWorkspace).toBeDefined();
  });
  it("reports missing and archived workspaces and explicitly returns to Ready", async () => {
    await createWorkspace("default", "abcdef", { setupId: "setup", name: "test" });
    await expect(unlinkWorkspace("default", "abcdef")).rejects.toThrow("Only missing");
    archived = true; expect((await workspaceState("default", "abcdef")).status).toBe("archived");
    missing = true; expect((await workspaceState("default", "abcdef")).status).toBe("missing");
    await unlinkWorkspace("default", "abcdef"); expect(readStore().projects[0]!.tasks[0]!.orcaWorkspace).toBeUndefined();
  });
  it("guards side-effectful HTTP routes by origin and broadcasts the saved binding", async () => {
    const { startServer } = await import("../src/server/server"); const server = await startServer({ preferredPort: 0 });
    const path = server.url + "/api/projects/default/tasks/abcdef/workspace";
    try {
      const body = JSON.stringify({ setupId: "setup", name: "HTTP test" });
      expect((await fetch(path, { method: "POST", body })).status).toBe(403);
      const response = await fetch(path, { method: "POST", headers: { Origin: server.url, "Content-Type": "application/json" }, body });
      expect(response.status).toBe(200); expect((await response.json() as any).task.progress).toBe("in_progress");
      expect((await (await fetch(path)).json() as any).status).toBe("available");
    } finally { await server.stop(); }
  });
  it("rejects malformed stored integration fields", () => {
    expect(() => validateGraph({ version: 1, tasks: [{ ...task(), orcaWorkspace: { id: "bad" } }], edges: [] })).toThrow("Invalid Orca");
  });
  it("refuses missing and ambiguous CLI matches without writing", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {});
    try {
      await workspaceCommand(["done", "--workspace", "unknown", "--json"]);
      expect(JSON.parse(log.mock.calls.at(-1)![0]).error).toBe("task_not_found");
      const result = await createWorkspace("default", "abcdef", { setupId: "setup", name: "test" });
      await withGraphLock(async () => { const store = readStore(); store.projects.push({ id: "duplicate", name: "Duplicate", version: 1, tasks: [{ ...task(), orcaWorkspace: result.orcaWorkspace }], edges: [] }); await saveStore(store); });
      await workspaceCommand(["done", "--workspace", result.orcaWorkspace!.identityKey, "--json"]);
      expect(JSON.parse(log.mock.calls.at(-1)![0]).error).toBe("ambiguous_workspace");
      expect(readStore().projects[0]!.tasks[0]!.doneAt).toBeNull();
    } finally { log.mockRestore(); process.exitCode = 0; }
  });
  it("checks blockers on workspace completion and reports unblocked tasks", async () => {
    const result = await createWorkspace("default", "abcdef", { setupId: "setup", name: "test" });
    await withGraphLock(async () => { const store = readStore(); const p = store.projects[0]!; p.tasks.push({ ...task(), id: "111111" }, { ...task(), id: "222222" }); p.edges.push({ from: "111111", to: "abcdef" }, { from: "abcdef", to: "222222" }); await saveStore(store); });
    const err = spyOn(console, "error").mockImplementation(() => {}); const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await workspaceCommand(["done", "--workspace", result.orcaWorkspace!.identityKey, "--json"]);
      expect(JSON.parse(err.mock.calls.at(-1)![0]).error).toBe("task_blocked");
      await withGraphLock(async () => { const store = readStore(); store.projects[0]!.tasks[1]!.doneAt = new Date().toISOString(); await saveStore(store); });
      await workspaceCommand(["done", "--workspace", result.orcaWorkspace!.identityKey, "--json"]);
      expect(JSON.parse(log.mock.calls.at(-1)![0]).unblocked[0].id).toBe("222222");
    } finally { err.mockRestore(); log.mockRestore(); process.exitCode = 0; }
  });
  it("allows offline CLI instructions and resets an uncertain reservation explicitly", async () => {
    fail = true;
    await expect(createWorkspace("default", "abcdef", { setupId: "setup", name: "test" })).rejects.toThrow();
    await reconcile("default", "abcdef", { reset: true });
    expect(readStore().projects[0]!.tasks[0]!.orcaCreation).toBeUndefined();
    fail = false; await createWorkspace("default", "abcdef", { setupId: "setup", name: "test" });
    setOrcaRunnerForTests(async () => { throw new OrcaError("runtime_not_running", "Start Orca"); });
    const state = await workspaceState("default", "abcdef");
    expect(state.status).toBe("unavailable"); expect(state.instructions).toContain(dir); expect(state.instructions).toContain("workspace done");
    expect(state.instructions).toContain("dagdo.ts");
  });
  const jsonCommand = async (...args: string[]) => {
    const log = spyOn(console, "log").mockImplementation(() => {}), err = spyOn(console, "error").mockImplementation(() => {});
    try {
      await withProject("", () => workspaceCommand([...args, "--json"]));
      if (process.exitCode) throw new OrcaError(JSON.parse(err.mock.calls.at(-1)![0]).error, "Command failed");
      return JSON.parse(log.mock.calls.at(-1)![0]);
    } finally { log.mockRestore(); err.mockRestore(); process.exitCode = 0; }
  };
  const failure = (...args: string[]) => jsonCommand(...args).then(() => "succeeded", (error: OrcaError) => error.code);
  const reserve = (startedAt: string) => withOrcaWrite(() => withGraphLock(async () => {
    const store = readStore();
    store.projects[0]!.tasks[0]!.orcaCreation = { requestId: "other-process", setupId: "setup", repoId: "repo", name: "test", setup: "inherit", startedAt };
    await saveStore(store);
  }));
  it("drives the browser's workspace actions from the CLI", async () => {
    expect((await jsonCommand("projects")).projects[0]).toMatchObject({ id: "setup", displayName: "Test project", baseRef: "main" });
    expect((await jsonCommand("refs", "--orca-project", "setup", "--query", "ma")).refs).toHaveLength(2);
    expect(calls.at(-1)).toEqual(expect.arrayContaining(["--repo", "id:repo", "--query", "ma"]));
    expect(await failure("refs", "--orca-project", "unknown")).toBe("invalid_project");
    expect(await jsonCommand("start")).toEqual({ ok: true });
    expect(await jsonCommand("status", "--task", "abc")).toMatchObject({ status: "none", task: { id: "abcdef" } });

    const created = await jsonCommand("create", "--task", "abc", "--orca-project", "setup", "--base", "main", "--branch", "feature/x", "--hooks", "skip", "--open");
    expect(created).toMatchObject({ opened: true, task: { progress: "in_progress" } });
    const create = calls.find(c => c[1] === "create")!;
    expect(create).toEqual(expect.arrayContaining([task().title, "--base-branch", "main", "--branch", "feature/x", "--setup", "skip"]));
    expect(await failure("create", "--task", "abc", "--orca-project", "setup")).toBe("workspace_exists");

    expect(await jsonCommand("status", "--task", "abcdef")).toMatchObject({ status: "available" });
    expect(await jsonCommand("open", "--task", "abcdef")).toEqual({ ok: true });
    expect(await failure("unlink", "--task", "abcdef")).toBe("workspace_active");
    archived = true;
    expect((await jsonCommand("unlink", "--task", "abcdef")).task).toMatchObject({ id: "abcdef", progress: "ready" });
    expect(readStore().projects[0]!.tasks[0]!.orcaWorkspace).toBeUndefined();
  });
  it("reports an open failure without hiding the created workspace", async () => {
    const created = await jsonCommand("create", "--task", "abcdef", "--orca-project", "setup");
    expect(created.opened).toBe(false);
    await withOrcaWrite(() => withGraphLock(async () => { const store = readStore(); delete store.projects[0]!.tasks[0]!.orcaWorkspace; store.projects[0]!.tasks[0]!.progress = "ready"; await saveStore(store); }));
    worktrees = []; missing = true;
    const failed = await jsonCommand("create", "--task", "abcdef", "--orca-project", "setup", "--open");
    expect(failed).toMatchObject({ opened: false, task: { progress: "in_progress" } });
    expect(failed.openError).toContain("unavailable");
  });
  it("validates CLI input and requires a project selection", async () => {
    expect(await failure("status")).toBe("invalid_input");
    expect(await failure("frobnicate")).toBe("invalid_input");
    expect(await failure("status", "--task", "000")).toBe("task_not_found");
    expect(await failure("create", "--task", "abcdef")).toBe("invalid_input");
    expect(await failure("create", "--task", "abcdef", "--orca-project", "unknown")).toBe("invalid_project");
    expect(await failure("reconcile", "--task", "abcdef", "--reset", "--workspace", "id:x")).toBe("invalid_input");
    await withGraphLock(async () => { const store = readStore(); store.projects.push({ id: "other", name: "Other", version: 1, tasks: [], edges: [] }); await saveStore(store); });
    expect(await failure("status", "--task", "abcdef")).toBe("project_required");
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await workspaceCommand(["status", "--task", "abcdef", "--json"], "default");
      expect(JSON.parse(log.mock.calls.at(-1)![0]).status).toBe("none");
    } finally { log.mockRestore(); }
  });
  it("does not reconcile a recent reservation owned by another process", async () => {
    await reserve(new Date().toISOString());
    expect(await failure("reconcile", "--task", "abcdef", "--reset")).toBe("creation_busy");
    expect(await failure("reconcile", "--task", "abcdef")).toBe("creation_busy");
    expect(readStore().projects[0]!.tasks[0]!.orcaCreation).toBeDefined();
    await withOrcaWrite(() => withGraphLock(async () => { const store = readStore(); delete store.projects[0]!.tasks[0]!.orcaCreation; await saveStore(store); }));
    await reserve(new Date(Date.now() - 120_000).toISOString());
    expect(await failure("reconcile", "--task", "abcdef")).toBe("recovery_required");
    expect((await jsonCommand("reconcile", "--task", "abcdef", "--reset")).task.orcaCreation).toBeUndefined();
  });
  it("links an existing workspace through the CLI", async () => {
    worktrees.push({ id: "repo::existing", identity: { key: "wt2:local:existing" }, repoId: "repo", hostId: "local", projectId: "project", path: dir, displayName: "Existing", branch: "main" });
    await reserve(new Date(Date.now() - 120_000).toISOString());
    const linked = await jsonCommand("reconcile", "--task", "abcdef", "--workspace", "id:repo::existing");
    expect(linked.task.orcaWorkspace.identityKey).toBe("wt2:local:existing");
  });
});
